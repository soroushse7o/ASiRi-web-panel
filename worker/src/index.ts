import { connect } from "cloudflare:sockets"

// Cloudflare Worker tunnel: accepts a WebSocket on WS_PATH and relays its binary messages to a raw TCP target
// (env.TARGET_HOST : Number(env.TARGET_PORT)) through cloudflare:sockets. Every other request is reverse-proxied
// to ORIGIN (or answered 404 when ORIGIN is empty), so the Worker domain looks like an ordinary site.

export interface Env {
  /** Origin that serves ordinary (non-WebSocket) requests, e.g. "https://panel.example.com". */
  ORIGIN: string
  /** Secret WebSocket path, e.g. "/ws/abcdef123456". */
  WS_PATH: string
  TARGET_HOST: string
  TARGET_PORT: string
}

/** Max bytes queued towards the TCP socket while it applies backpressure. */
const MAX_QUEUED_BYTES = 1 << 20

const WS_OPEN = 1

function normPath(p: string) {
  return p.replace(/\/+$/, "") || "/"
}

function text(status: number, body = "") {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } })
}

async function proxyToOrigin(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.ORIGIN) return text(404, "Not Found")
  let target: URL
  try {
    target = new URL(url.pathname + url.search, env.ORIGIN)
  } catch {
    return text(500, "Bad ORIGIN")
  }
  return fetch(new Request(target, request))
}

function tunnel(env: Env): Promise<Response> {
  const port = Number(env.TARGET_PORT)
  if (!env.TARGET_HOST || !Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve(text(500, "Tunnel target is not configured"))
  }
  return openTunnel(env.TARGET_HOST, port)
}

async function openTunnel(host: string, port: number): Promise<Response> {
  // Connect BEFORE accepting the WebSocket: if the target is unreachable the client gets an immediate 502
  // instead of an upgrade that dies later.
  const socket = connect({ hostname: host, port }, { allowHalfOpen: false })
  try {
    await socket.opened
  } catch {
    try {
      await socket.close()
    } catch {
      // already dead
    }
    return text(502, "Upstream unavailable")
  }

  const pair = new WebSocketPair()
  const client = pair[0]
  const server = pair[1]
  server.accept()

  const writer = socket.writable.getWriter()
  const reader = socket.readable.getReader()

  let finished = false
  let queued = 0
  let chain: Promise<void> = Promise.resolve()

  // Single teardown path, safe to call from any listener, any number of times.
  const finish = (code: number, reason: string) => {
    if (finished) return
    finished = true
    if (server.readyState === WS_OPEN || server.readyState === 0) {
      try {
        server.close(code, reason.slice(0, 120))
      } catch {
        // already closed
      }
    }
    reader.cancel().catch(() => {})
    writer.close().catch(() => {})
    socket.close().catch(() => {})
  }

  // ---- client -> target (strict backpressure: one write at a time, wait for writer.ready) ----
  server.addEventListener("message", (event: MessageEvent) => {
    if (finished) return
    const data = event.data
    const chunk = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data as ArrayBuffer)
    if (!chunk.byteLength) return
    queued += chunk.byteLength
    if (queued > MAX_QUEUED_BYTES) return finish(1013, "target too slow")
    chain = chain
      .then(async () => {
        if (finished) return
        await writer.ready
        await writer.write(chunk)
      })
      .then(
        () => {
          queued -= chunk.byteLength
        },
        () => finish(1011, "target write failed"),
      )
  })
  server.addEventListener("close", () => finish(1000, "client closed"))
  server.addEventListener("error", () => finish(1011, "client error"))

  // ---- target -> client (pull based: the next read only happens after the previous chunk was sent) ----
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return finish(1000, "target closed")
        if (finished) return
        server.send(value)
      }
    } catch {
      finish(1011, "target error")
    }
  })()

  // Upstream drop: reject the incoming side right away, whichever way the socket ends.
  socket.closed.then(
    () => finish(1000, "target closed"),
    () => finish(1011, "target error"),
  )

  return new Response(null, { status: 101, webSocket: client })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return text(400, "Bad Request")
    }
    const isWs = request.headers.get("Upgrade")?.toLowerCase() === "websocket"
    if (normPath(url.pathname) === normPath(env.WS_PATH || "/") && env.WS_PATH) {
      if (!isWs) return text(426, "Upgrade Required")
      if (request.method !== "GET") return text(405, "Method Not Allowed")
      return tunnel(env)
    }
    return proxyToOrigin(request, env, url)
  },
} satisfies ExportedHandler<Env>
