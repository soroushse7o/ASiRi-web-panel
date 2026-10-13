import "server-only"
import { createHash, timingSafeEqual } from "node:crypto"
import type { IncomingMessage } from "node:http"
import type net from "node:net"
import type { Duplex } from "node:stream"
import { connectViaUpstream, endAfterDrain, IDLE_TIMEOUT_MS } from "./gateway"
import type { InboundConfig } from "./relay"

// VLESS / Trojan inbound over WebSocket, served on the panel's own HTTP port (so Railway's edge terminates TLS on
// 443 and forwards the WebSocket upgrade). Traffic exits through the local Aether SOCKS5. No external dependency:
// the RFC 6455 framing needed here is implemented below. TCP only (UDP/mux commands are refused).

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const MAX_FRAME = 1 << 20
const MAX_SESSIONS = 512
const PING_MS = 25_000
/** The first valid VLESS/Trojan header must arrive within this time after the WebSocket upgrade. */
const HEADER_TIMEOUT_MS = 10_000
/** Concurrent WebSocket sessions allowed per client IP (INBOUND_MAX_PER_IP). */
const MAX_PER_IP = (() => {
  const n = Math.floor(Number(process.env.INBOUND_MAX_PER_IP))
  return Number.isFinite(n) && n > 0 ? n : 32
})()
/** Max bytes buffered while the upstream connection is still being opened. */
const MAX_PENDING = 1 << 20
/** Grace period for the peer to answer our Close frame before the socket is destroyed. */
const CLOSE_GRACE_MS = 2_000

export interface InboundIdentity {
  uuid: string
  /** hex(sha224(uuid)) as Trojan sends it (the uuid is the Trojan credential). */
  trojanHash: string
  path: string
}

export function deriveInbound(username: string, password: string, pathOverride: string | null): InboundIdentity {
  const h = createHash("sha256").update(`aether-vless-v1:${username}:${password}`).digest()
  h[6] = (h[6] & 0x0f) | 0x40
  h[8] = (h[8] & 0x3f) | 0x80
  const hex = h.subarray(0, 16).toString("hex")
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  const trojanHash = createHash("sha224").update(uuid).digest("hex")
  const path = pathOverride ?? `/ws/${createHash("sha256").update(`aether-path-v1:${password}`).digest("hex").slice(0, 12)}`
  return { uuid, trojanHash, path }
}

export interface InboundLink {
  protocol: "vless-ws" | "trojan-ws"
  label: string
  uri: string
}

export function buildInboundLinks(cfg: InboundConfig, ident: InboundIdentity, _password: string, name = "ASiRi"): InboundLink[] {
  if (!cfg.enabled || !cfg.publicHost) return []
  const host = cfg.publicHost
  const path = encodeURIComponent(ident.path)
  const out: InboundLink[] = []
  if (cfg.vless) {
    out.push({
      protocol: "vless-ws",
      label: "VLESS + WebSocket + TLS",
      uri: `vless://${ident.uuid}@${host}:443?encryption=none&security=tls&insecure=0&type=ws&host=${host}&allowInsecure=0&alpn=http%2F1.1&sni=${host}&fp=chrome&path=${path}#${encodeURIComponent(`${name}-VLESS-WS`)}`,
    })
  }
  if (cfg.trojan) {
    out.push({
      protocol: "trojan-ws",
      label: "Trojan + WebSocket + TLS",
      uri: `trojan://${ident.uuid}@${host}:443?allowInsecure=0&fp=chrome&host=${host}&type=ws&security=tls&sni=${host}&insecure=0&path=${path}&alpn=http%2F1.1#${encodeURIComponent(`${name}-Trojan-WS`)}`,
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------
// WebSocket framing
// ---------------------------------------------------------------------------------------------------------

interface Frame {
  fin: boolean
  opcode: number
  payload: Buffer
}

/**
 * Chunk queue: appending is O(1) and bytes are only copied once, when a complete frame is cut out. This replaces
 * the old `Buffer.concat([buf, chunk])` per push, which re-copied the whole backlog for every incoming chunk (O(n²)).
 */
class ByteQueue {
  private chunks: Buffer[] = []
  private head = 0
  length = 0

  push(chunk: Buffer) {
    if (!chunk.length) return
    this.chunks.push(chunk)
    this.length += chunk.length
  }

  /** First `n` bytes without consuming them (n must be <= length; only used for tiny headers). */
  peek(n: number): Buffer {
    const first = this.chunks[0]
    if (first.length - this.head >= n) return first.subarray(this.head, this.head + n)
    const out = Buffer.allocUnsafe(n)
    let got = 0
    for (let i = 0; got < n; i++) {
      const c = this.chunks[i]
      const from = i === 0 ? this.head : 0
      const take = Math.min(c.length - from, n - got)
      c.copy(out, got, from, from + take)
      got += take
    }
    return out
  }

  /** Removes and returns the first `n` bytes (zero-copy when they sit in a single chunk). */
  take(n: number): Buffer {
    this.length -= n
    const first = this.chunks[0]
    if (first.length - this.head >= n) {
      const out = first.subarray(this.head, this.head + n)
      this.head += n
      if (this.head === first.length) {
        this.chunks.shift()
        this.head = 0
      }
      return out
    }
    const out = Buffer.allocUnsafe(n)
    let got = 0
    while (got < n) {
      const c = this.chunks[0]
      const take = Math.min(c.length - this.head, n - got)
      c.copy(out, got, this.head, this.head + take)
      got += take
      this.head += take
      if (this.head === c.length) {
        this.chunks.shift()
        this.head = 0
      }
    }
    return out
  }
}

export class FrameParser {
  private q = new ByteQueue()
  /** true while a fragmented data message is in progress (a continuation frame is expected). */
  private fragmented = false

  /**
   * Returns complete frames. Throws on any protocol violation so the caller can drop the connection:
   * unmasked client frame, oversized frame, reserved bits, unknown opcode, malformed control frame,
   * or a bad fragmentation sequence.
   */
  push(chunk: Buffer): Frame[] {
    this.q.push(chunk)
    const frames: Frame[] = []
    for (;;) {
      const have = this.q.length
      if (have < 2) break
      const h = this.q.peek(Math.min(have, 14))
      const fin = (h[0] & 0x80) !== 0
      if (h[0] & 0x70) throw new Error("reserved bits set")
      const opcode = h[0] & 0x0f
      const control = opcode >= 8
      if (!(opcode <= 2 || (opcode >= 8 && opcode <= 10))) throw new Error("unknown opcode")
      const masked = (h[1] & 0x80) !== 0
      if (!masked) throw new Error("unmasked client frame")
      let len = h[1] & 0x7f
      let off = 2
      if (len === 126) {
        if (have < 4) break
        len = h.readUInt16BE(2)
        off = 4
      } else if (len === 127) {
        if (have < 10) break
        const big = h.readBigUInt64BE(2)
        if (big > BigInt(MAX_FRAME)) throw new Error("frame too large")
        len = Number(big)
        off = 10
      }
      if (len > MAX_FRAME) throw new Error("frame too large")
      if (control && (!fin || len > 125)) throw new Error("malformed control frame")
      if (opcode === 8 && len === 1) throw new Error("malformed close frame")
      if (!control) {
        if (opcode === 0 && !this.fragmented) throw new Error("unexpected continuation frame")
        if (opcode !== 0 && this.fragmented) throw new Error("data frame inside fragmented message")
      }
      const total = off + 4 + len
      if (have < total) break
      const frame = this.q.take(total)
      const mask = frame.subarray(off, off + 4)
      const payload = frame.subarray(off + 4)
      // The slice belongs to us (socket chunk or a fresh concat), so unmasking in place is safe.
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]
      if (!control) this.fragmented = !fin
      frames.push({ fin, opcode, payload })
    }
    return frames
  }
}

export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const n = payload.length
  let head: Buffer
  if (n < 126) head = Buffer.from([0x80 | opcode, n])
  else if (n < 65536) {
    head = Buffer.alloc(4)
    head[0] = 0x80 | opcode
    head[1] = 126
    head.writeUInt16BE(n, 2)
  } else {
    head = Buffer.alloc(10)
    head[0] = 0x80 | opcode
    head[1] = 127
    head.writeBigUInt64BE(BigInt(n), 2)
  }
  return Buffer.concat([head, payload])
}

// ---------------------------------------------------------------------------------------------------------
// VLESS / Trojan request headers
// ---------------------------------------------------------------------------------------------------------

export interface Target {
  host: string
  port: number
}
export type HeaderResult = { ok: true; target: Target; consumed: number; protocol: "vless" | "trojan" } | { ok: false; reason: string } | null

function ipv6(buf: Buffer) {
  const g: string[] = []
  for (let i = 0; i < 8; i++) g.push(buf.readUInt16BE(i * 2).toString(16))
  return g.join(":")
}

function eqHex(a: Buffer, hexExpected: string) {
  const b = Buffer.from(hexExpected, "latin1")
  return a.length === b.length && timingSafeEqual(a, b)
}

/** null = need more bytes. */
export function parseRequestHeader(buf: Buffer, ident: InboundIdentity, allow: { vless: boolean; trojan: boolean }): HeaderResult {
  if (buf.length < 1) return null
  if (buf[0] === 0 && allow.vless) {
    if (buf.length < 18) return null
    const uuid = Buffer.from(ident.uuid.replace(/-/g, ""), "hex")
    if (!timingSafeEqual(buf.subarray(1, 17), uuid)) return { ok: false, reason: "bad uuid" }
    const addons = buf[17]
    let off = 18 + addons
    if (buf.length < off + 4) return null
    const cmd = buf[off]
    if (cmd !== 1) return { ok: false, reason: "only TCP is supported" }
    const port = buf.readUInt16BE(off + 1)
    const atyp = buf[off + 3]
    off += 4
    let host: string
    if (atyp === 1) {
      if (buf.length < off + 4) return null
      host = [...buf.subarray(off, off + 4)].join(".")
      off += 4
    } else if (atyp === 2) {
      if (buf.length < off + 1) return null
      const len = buf[off]
      if (len === 0) return { ok: false, reason: "empty host" }
      if (buf.length < off + 1 + len) return null
      host = buf.subarray(off + 1, off + 1 + len).toString("utf8")
      off += 1 + len
    } else if (atyp === 3) {
      if (buf.length < off + 16) return null
      host = ipv6(buf.subarray(off, off + 16))
      off += 16
    } else return { ok: false, reason: "bad address type" }
    return { ok: true, target: { host, port }, consumed: off, protocol: "vless" }
  }
  if (allow.trojan && /^[0-9a-f]$/i.test(String.fromCharCode(buf[0]))) {
    if (buf.length < 58) return null
    if (!eqHex(buf.subarray(0, 56), ident.trojanHash) || buf[56] !== 0x0d || buf[57] !== 0x0a) return { ok: false, reason: "bad password" }
    let off = 58
    if (buf.length < off + 2) return null
    if (buf[off] !== 1) return { ok: false, reason: "only CONNECT is supported" }
    const atyp = buf[off + 1]
    off += 2
    let host: string
    if (atyp === 1) {
      if (buf.length < off + 4) return null
      host = [...buf.subarray(off, off + 4)].join(".")
      off += 4
    } else if (atyp === 3) {
      if (buf.length < off + 1) return null
      const len = buf[off]
      if (len === 0) return { ok: false, reason: "empty host" }
      if (buf.length < off + 1 + len) return null
      host = buf.subarray(off + 1, off + 1 + len).toString("utf8")
      off += 1 + len
    } else if (atyp === 4) {
      if (buf.length < off + 16) return null
      host = ipv6(buf.subarray(off, off + 16))
      off += 16
    } else return { ok: false, reason: "bad address type" }
    if (buf.length < off + 4) return null
    const port = buf.readUInt16BE(off)
    if (buf[off + 2] !== 0x0d || buf[off + 3] !== 0x0a) return { ok: false, reason: "bad request" }
    return { ok: true, target: { host, port }, consumed: off + 4, protocol: "trojan" }
  }
  return { ok: false, reason: "unknown protocol" }
}

// ---------------------------------------------------------------------------------------------------------
// Upgrade handler
// ---------------------------------------------------------------------------------------------------------

export interface InboundRuntime {
  /** false while sharing is off: the path answers 404 like any unknown page. */
  active: boolean
  vless: boolean
  trojan: boolean
  ident: InboundIdentity
  upstreamPort: number | null
  /** Registers the socket in the share state (counters + closed on stop). */
  track: (socket: net.Socket) => void
  onAuthFailure: (remote: string | undefined) => Promise<void>
}

let sessions = 0
const perIp = new Map<string, number>()

function reject(socket: Duplex, status: string) {
  if (socket.destroyed) return
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  // A well-behaved client closes after the response; make sure a stalled one cannot hold the socket open.
  const t = setTimeout(() => socket.destroy(), CLOSE_GRACE_MS)
  t.unref?.()
  socket.once("close", () => clearTimeout(t))
}

/** Answers a refused/unknown upgrade with a real HTTP response instead of dropping the TCP connection. */
export function rejectUpgrade(socket: Duplex, status = "404 Not Found") {
  reject(socket, status)
}

function remoteOf(req: IncomingMessage) {
  const real = req.headers["x-real-ip"]
  if (typeof real === "string" && real) return real.trim()
  const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  return fwd.at(-1) ?? req.socket.remoteAddress
}

/** Returns true when the request was claimed (handled or refused), false when it is not for this inbound. */
export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, rt: InboundRuntime | null): boolean {
  if (!rt) return false
  let url: URL
  try {
    url = new URL(req.url ?? "/", "http://localhost")
  } catch {
    return false
  }
  const pathname = url.pathname.replace(/\/+$/, "") || "/"
  if (pathname !== rt.ident.path) return false

  const upgrade = String(req.headers.upgrade ?? "").toLowerCase()
  const key = String(req.headers["sec-websocket-key"] ?? "")
  if (!rt.active || !rt.upstreamPort) {
    reject(socket, "404 Not Found")
    return true
  }
  // Sec-WebSocket-Key must be a base64 16-byte nonce (24 chars).
  const keyOk = /^[A-Za-z0-9+/]{22}==$/.test(key)
  if (req.method !== "GET" || upgrade !== "websocket" || String(req.headers["sec-websocket-version"]) !== "13" || !keyOk) {
    reject(socket, "400 Bad Request")
    return true
  }
  if (sessions >= MAX_SESSIONS) {
    reject(socket, "503 Service Unavailable")
    return true
  }
  const remote = remoteOf(req)
  const ipKey = remote ?? "?"
  if ((perIp.get(ipKey) ?? 0) >= MAX_PER_IP) {
    reject(socket, "429 Too Many Requests")
    return true
  }

  const accept = createHash("sha1").update(key + WS_GUID).digest("base64")
  const protoHeader = String(req.headers["sec-websocket-protocol"] ?? "").split(",")[0].trim()
  let early: Buffer | null = null
  if (protoHeader && url.searchParams.has("ed")) {
    // Xray-style early data: the first payload travels base64url-encoded in Sec-WebSocket-Protocol.
    early = Buffer.from(protoHeader, "base64url")
  }
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n` +
      (protoHeader ? `Sec-WebSocket-Protocol: ${protoHeader}\r\n` : "") +
      "\r\n",
  )
  runSession(socket as net.Socket, head, early, rt, remote, ipKey)
  return true
}

function runSession(socket: net.Socket, head: Buffer, early: Buffer | null, rt: InboundRuntime, remote: string | undefined, ipKey: string) {
  sessions += 1
  perIp.set(ipKey, (perIp.get(ipKey) ?? 0) + 1)
  rt.track(socket)
  socket.setNoDelay(true)
  socket.setKeepAlive(true, 30_000)
  socket.setTimeout(0)

  const parser = new FrameParser()
  let hbuf: Buffer = Buffer.alloc(0)
  let upstream: net.Socket | null = null
  let connecting = false
  let closed = false
  let closing = false
  let vlessReply = false
  let rejected = false
  let upstreamDrain = false
  let pendingBytes = 0
  let alive = true
  let lastPayloadAt = Date.now()
  const pending: Buffer[] = []

  // Drop clients that never send a valid first header.
  const headerTimer = setTimeout(() => {
    if (!connecting && !rejected) {
      rejected = true
      closeWs(1008)
    }
  }, HEADER_TIMEOUT_MS)
  headerTimer.unref?.()

  // Heartbeat: any inbound frame proves liveness; a full interval without one after our ping = dead peer.
  const ping = setInterval(() => {
    if (closed || socket.destroyed) return
    if (!alive) return cleanup(false)
    if (Date.now() - lastPayloadAt > IDLE_TIMEOUT_MS) return closeWs(1001)
    alive = false
    socket.write(encodeFrame(9, Buffer.alloc(0)))
  }, PING_MS)
  ping.unref?.()

  const cleanup = (graceful: boolean) => {
    if (closed) return
    closed = true
    sessions -= 1
    const left = (perIp.get(ipKey) ?? 1) - 1
    if (left > 0) perIp.set(ipKey, left)
    else perIp.delete(ipKey)
    clearInterval(ping)
    clearTimeout(headerTimer)
    pending.length = 0
    if (upstream) {
      // Let bytes already handed to the upstream socket reach their destination before closing it.
      if (graceful) endAfterDrain(upstream)
      else upstream.destroy()
    }
    socket.destroy()
  }
  socket.on("close", () => cleanup(true))
  socket.on("error", () => cleanup(false))
  socket.on("timeout", () => cleanup(false))

  /** Sends a Close frame (flushed before the socket ends); destroys after a grace period if the peer stalls. */
  const closeWs = (code: number) => {
    if (closed || closing || socket.destroyed) return
    closing = true
    clearTimeout(headerTimer)
    const p = Buffer.alloc(2)
    p.writeUInt16BE(code)
    socket.end(encodeFrame(8, p))
    const t = setTimeout(() => cleanup(true), CLOSE_GRACE_MS)
    t.unref?.()
    socket.once("close", () => clearTimeout(t))
  }

  const toUpstream = (data: Buffer) => {
    if (!data.length || closed) return
    if (!upstream) {
      pendingBytes += data.length
      if (pendingBytes > MAX_PENDING) return closeWs(1009)
      pending.push(data)
      return
    }
    if (!upstream.write(data) && !upstreamDrain) {
      upstreamDrain = true
      socket.pause()
      upstream.once("drain", () => {
        upstreamDrain = false
        if (!closed) socket.resume()
      })
    }
  }

  const open = async (target: Target, firstPayload: Buffer, protocol: "vless" | "trojan") => {
    connecting = true
    clearTimeout(headerTimer)
    // Do not read more client data while the upstream connection is being established: it is buffered by the
    // kernel / TCP window (backpressure) instead of piling up in memory.
    socket.pause()
    try {
      const up = await connectViaUpstream(rt.upstreamPort as number, target.host, target.port)
      if (closed || closing) return up.sock.destroy()
      upstream = up.sock
      up.sock.on("error", () => {
        closeWs(1011)
        up.sock.destroy()
      })
      up.sock.on("close", () => closeWs(1000))
      up.sock.setTimeout(IDLE_TIMEOUT_MS, () => closeWs(1001))
      up.sock.on("data", (d: Buffer | string) => {
        if (closed || closing) return
        lastPayloadAt = Date.now()
        const chunk: Buffer = typeof d === "string" ? Buffer.from(d) : d
        if (!socket.write(encodeFrame(2, chunk))) {
          up.sock.pause()
          socket.once("drain", () => up.sock.resume())
        }
      })
      up.sock.resume()
      if (protocol === "vless" && !vlessReply) {
        vlessReply = true
        socket.write(encodeFrame(2, Buffer.from([0, 0])))
      }
      if (up.rest.length) socket.write(encodeFrame(2, up.rest))
      toUpstream(firstPayload)
      for (const p of pending.splice(0)) toUpstream(p)
      pendingBytes = 0
      if (!upstreamDrain) socket.resume()
    } catch {
      closeWs(1011)
    }
  }

  const onMessageBytes = (data: Buffer) => {
    if (rejected || closing) return
    if (connecting) return toUpstream(data)
    hbuf = hbuf.length ? Buffer.concat([hbuf, data]) : data
    if (hbuf.length > 4096) return closeWs(1009)
    const res = parseRequestHeader(hbuf, rt.ident, { vless: rt.vless, trojan: rt.trojan })
    if (!res) return
    if (!res.ok) {
      rejected = true
      clearTimeout(headerTimer)
      void rt.onAuthFailure(remote).finally(() => closeWs(1008))
      return
    }
    void open(res.target, hbuf.subarray(res.consumed), res.protocol)
  }

  const onData = (chunk: Buffer) => {
    if (closing) return
    alive = true
    let frames: Frame[]
    try {
      frames = parser.push(chunk)
    } catch {
      // Malformed packet: strict drop with a protocol-error Close frame (1002), never forwarded.
      return closeWs(1002)
    }
    for (const f of frames) {
      if (f.opcode === 0 || f.opcode === 1 || f.opcode === 2) {
        lastPayloadAt = Date.now()
        onMessageBytes(f.payload)
      } else if (f.opcode === 9) socket.write(encodeFrame(10, f.payload))
      else if (f.opcode === 8) return closeWs(1000)
      // opcode 10 (pong): liveness already recorded above
      if (closing) return
    }
  }

  socket.on("data", onData)
  if (early?.length) onMessageBytes(early)
  if (head.length) onData(head)
  // `connecting` means open() paused the socket on purpose until the upstream is ready.
  if (!connecting && !closing) socket.resume()
}
