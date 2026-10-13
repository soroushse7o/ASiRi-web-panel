import http from "node:http"
import net from "node:net"

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once("error", reject)
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo
      s.close(() => resolve(port))
    })
  })
}

export async function waitFor<T>(fn: () => T | undefined | false | null, timeoutMs = 10_000, label = "condition"): Promise<T> {
  const started = Date.now()
  for (;;) {
    const v = fn()
    if (v) return v as T
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

export interface Hook {
  event: string
  text: string
  data: Record<string, unknown>
}

/** Local webhook receiver that records every POST body. */
export async function startWebhook() {
  const received: Hook[] = []
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      try {
        received.push(JSON.parse(body) as Hook)
      } catch {
        // ignore malformed
      }
      res.end("ok")
    })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const { port } = server.address() as net.AddressInfo
  return { url: `http://127.0.0.1:${port}/hook`, received, close: () => new Promise<void>((r) => server.close(() => r())) }
}

/** Fake upstream "Aether" SOCKS5 server: accepts the no-auth greeting, then idles. */
export async function startFakeUpstream() {
  const server = net.createServer((sock) => {
    sock.once("data", () => sock.write(Buffer.from([5, 0])))
    sock.on("error", () => {})
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  return { port: (server.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => server.close(() => r())) }
}

/** SOCKS5 username/password handshake against `port`; resolves with the auth status byte (0 = success). */
export function socksLogin(port: number, user: string, pass: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1")
    let stage = 0
    sock.on("error", reject)
    sock.on("connect", () => sock.write(Buffer.from([5, 1, 2])))
    sock.on("data", (d: Buffer) => {
      if (stage === 0) {
        stage = 1
        sock.write(Buffer.concat([Buffer.from([1, user.length]), Buffer.from(user), Buffer.from([pass.length]), Buffer.from(pass)]))
      } else {
        sock.destroy()
        resolve(d[1])
      }
    })
  })
}

/** TCP echo server. */
export async function startEcho() {
  const server = net.createServer((sock) => {
    sock.on("error", () => {})
    sock.pipe(sock)
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  return { port: (server.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => server.close(() => r())) }
}

/** Fake Aether SOCKS5 (no auth) that really connects to the requested target, so end-to-end traffic flows. */
export async function startSocksUpstream() {
  const server = net.createServer((sock) => {
    sock.on("error", () => {})
    let stage = 0
    let buf = Buffer.alloc(0)
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d])
      if (stage === 0 && buf.length >= 3) {
        sock.write(Buffer.from([5, 0]))
        buf = buf.subarray(3)
        stage = 1
      }
      if (stage === 1 && buf.length >= 4) {
        let host = ""
        let off = 0
        if (buf[3] === 1 && buf.length >= 10) {
          host = [...buf.subarray(4, 8)].join(".")
          off = 8
        } else if (buf[3] === 3 && buf.length >= 5 + buf[4] + 2) {
          host = buf.subarray(5, 5 + buf[4]).toString()
          off = 5 + buf[4]
        } else return
        const port = buf.readUInt16BE(off)
        const rest = buf.subarray(off + 2)
        stage = 2
        sock.off("data", onData)
        const target = net.connect(port, host === "localhost" ? "127.0.0.1" : host)
        target.on("error", () => {
          sock.write(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]))
          sock.end()
        })
        target.once("connect", () => {
          sock.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
          if (rest.length) target.write(rest)
          sock.pipe(target)
          target.pipe(sock)
        })
        sock.on("close", () => target.destroy())
        target.on("close", () => sock.destroy())
      }
    }
    sock.on("data", onData)
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  return { port: (server.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => server.close(() => r())) }
}

/** Reads exactly `n` bytes (or until close) from a socket into one buffer. */
export function collect(sock: net.Socket, n: number, timeoutMs = 5000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0)
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${n} bytes (got ${buf.length})`)), timeoutMs)
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d])
      if (buf.length >= n) {
        clearTimeout(timer)
        sock.off("data", onData)
        resolve(buf)
      }
    }
    sock.on("data", onData)
    sock.once("close", () => {
      clearTimeout(timer)
      resolve(buf)
    })
  })
}
