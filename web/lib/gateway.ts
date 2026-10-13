import "server-only"
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto"
import net from "node:net"
import { sleep } from "./ratelimit"
import type { GatewayProtocol, SsCipher } from "./relay"

// Multi-protocol gateway on a single TCP port, protocol detected from the first bytes:
//   SOCKS5 (user/pass)  - first byte 0x05 + a valid greeting
//   HTTP CONNECT        - starts with "CONNECT " (Basic proxy auth; plain text, unencrypted)
//   Shadowsocks AEAD    - anything else (random salt first; no handshake that DPI can fingerprint)
// All three exit through the local Aether SOCKS5 (no-auth) on `upstreamPort`.

export interface GatewayContext {
  username: string
  password: string
  upstreamPort: number | null
  protocols: GatewayProtocol[]
  ssCipher: SsCipher
  onAuthFailure: (listener: string, remote: string | undefined) => Promise<void>
}

export const HANDSHAKE_TIMEOUT_MS = 15_000

/** Idle timeout of an established tunnel connection: 5-10 minutes (GATEWAY_IDLE_SEC, clamped; default 10 min). */
export const IDLE_TIMEOUT_MS = (() => {
  const sec = Number(process.env.GATEWAY_IDLE_SEC)
  const v = Number.isFinite(sec) && sec > 0 ? sec : 600
  return Math.min(600, Math.max(300, v)) * 1000
})()
/** How long a half-closed socket may take to flush its write buffer before it is destroyed anyway. */
const DRAIN_GRACE_MS = 5_000

/**
 * Closes the write side only after everything already queued has been flushed (FIN after the data), instead of
 * destroy() which discards in-flight bytes. A timer destroys the socket if the peer never reads the rest.
 */
export function endAfterDrain(sock: net.Socket, graceMs = DRAIN_GRACE_MS) {
  if (sock.destroyed) return
  if (!sock.writableEnded) sock.end()
  sock.resume() // let the readable side finish so "close" can fire
  const t = setTimeout(() => sock.destroy(), graceMs)
  t.unref?.()
  sock.once("close", () => clearTimeout(t))
}

/** Arms the idle timer of an established connection; on expiry the socket is destroyed. */
export function armIdle(sock: net.Socket) {
  sock.setTimeout(IDLE_TIMEOUT_MS)
  if (!sock.listenerCount("timeout")) sock.on("timeout", () => sock.destroy())
}

export function safeEqual(a: Buffer | string, b: string) {
  const ab = typeof a === "string" ? Buffer.from(a) : a
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export function socketReader(sock: net.Socket) {
  let buf = Buffer.alloc(0)
  let wake: (() => void) | null = null
  let closed = false
  const onData = (d: Buffer) => {
    buf = Buffer.concat([buf, d])
    wake?.()
  }
  const onClose = () => {
    closed = true
    wake?.()
  }
  sock.on("data", onData)
  sock.on("close", onClose)
  const ensure = async (n: number) => {
    while (buf.length < n) {
      if (closed) throw new Error("socket closed")
      await new Promise<void>((resolve) => (wake = resolve))
      wake = null
    }
  }
  return {
    ensure,
    peek: () => buf,
    async read(n: number) {
      await ensure(n)
      const out = buf.subarray(0, n)
      buf = buf.subarray(n)
      return out
    },
    detach() {
      sock.pause()
      sock.off("data", onData)
      sock.off("close", onClose)
      return buf
    },
  }
}

export function connectUpstream(port: number) {
  return new Promise<net.Socket>((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1")
    sock.once("connect", () => resolve(sock))
    sock.once("error", reject)
  })
}

function addrBytes(host: string, port: number) {
  const portBuf = Buffer.alloc(2)
  portBuf.writeUInt16BE(port)
  if (net.isIPv4(host)) return Buffer.concat([Buffer.from([1, ...host.split(".").map(Number)]), portBuf])
  if (net.isIPv6(host)) {
    const groups = expandIPv6(host)
    return Buffer.concat([Buffer.from([4]), groups, portBuf])
  }
  const name = Buffer.from(host)
  if (name.length === 0 || name.length > 255) throw new Error("bad host")
  return Buffer.concat([Buffer.from([3, name.length]), name, portBuf])
}

function expandIPv6(ip: string) {
  let s = ip.split("%")[0]
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const p = v4[1].split(".").map(Number)
    s = s.replace(v4[1], `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`)
  }
  const [head, tail] = s.split("::")
  const h = head ? head.split(":") : []
  const t = tail !== undefined && tail ? tail.split(":") : []
  const fill = tail === undefined ? [] : Array(8 - h.length - t.length).fill("0")
  const all = [...h, ...fill, ...t]
  const out = Buffer.alloc(16)
  all.forEach((g, i) => out.writeUInt16BE(parseInt(g || "0", 16), i * 2))
  return out
}

/** Opens a TCP connection to host:port through the local Aether SOCKS5 (no auth). `rest` = bytes already received after the reply. */
export async function connectViaUpstream(upstreamPort: number, host: string, port: number): Promise<{ sock: net.Socket; rest: Buffer }> {
  const sock = await connectUpstream(upstreamPort)
  try {
    const onTimeout = () => sock.destroy(new Error("upstream timeout"))
    sock.setTimeout(HANDSHAKE_TIMEOUT_MS)
    sock.on("timeout", onTimeout)
    const reader = socketReader(sock)
    sock.write(Buffer.from([5, 1, 0]))
    const [ver, method] = await reader.read(2)
    if (ver !== 5 || method !== 0) throw new Error("upstream refused greeting")
    sock.write(Buffer.concat([Buffer.from([5, 1, 0]), addrBytes(host, port)]))
    const head = await reader.read(4)
    if (head[1] !== 0) throw new Error(`upstream connect failed (code ${head[1]})`)
    if (head[3] === 1) await reader.read(4 + 2)
    else if (head[3] === 4) await reader.read(16 + 2)
    else {
      const [len] = await reader.read(1)
      await reader.read(len + 2)
    }
    const rest = Buffer.from(reader.detach())
    sock.off("timeout", onTimeout)
    sock.setTimeout(0)
    return { sock, rest }
  } catch (err) {
    sock.destroy()
    throw err
  }
}

/**
 * Raw bidirectional pipe. When one side closes, the other side first flushes what is still buffered
 * (endAfterDrain) and is only then destroyed; idle connections are cut after IDLE_TIMEOUT_MS.
 */
export function bridge(a: net.Socket, b: net.Socket) {
  armIdle(a)
  armIdle(b)
  // "error" is always followed by "close", which does the cleanup; the handler only prevents an unhandled error.
  a.on("error", () => {})
  b.on("error", () => {})
  a.on("close", () => endAfterDrain(b))
  b.on("close", () => endAfterDrain(a))
  a.pipe(b)
  b.pipe(a)
  a.resume()
  b.resume()
}

// ---------------------------------------------------------------------------------------------------------
// HTTP CONNECT
// ---------------------------------------------------------------------------------------------------------

function parseConnectTarget(target: string): { host: string; port: number } | null {
  const m = target.match(/^\[([^\]]+)\]:(\d{1,5})$/) ?? target.match(/^([^:\s]+):(\d{1,5})$/)
  if (!m) return null
  const port = Number(m[2])
  return port >= 1 && port <= 65535 ? { host: m[1], port } : null
}

async function handleHttpConnect(client: net.Socket, listener: string, ctx: GatewayContext, reader: ReturnType<typeof socketReader>) {
  let head = ""
  let end = -1
  for (;;) {
    head = reader.peek().toString("latin1")
    end = head.indexOf("\r\n\r\n")
    if (end >= 0) break
    if (head.length > 8192) {
      client.end("HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n")
      return
    }
    await reader.ensure(head.length + 1)
  }
  const headerBytes = end + 4
  await reader.read(headerBytes)
  const lines = head.slice(0, end).split("\r\n")
  const [method, target] = lines[0].split(" ")
  if (method !== "CONNECT") {
    client.end("HTTP/1.1 405 Method Not Allowed\r\nAllow: CONNECT\r\nConnection: close\r\n\r\n")
    return
  }
  const auth = lines.slice(1).find((l) => /^proxy-authorization:/i.test(l))?.split(":").slice(1).join(":").trim() ?? ""
  const [scheme, encoded] = auth.split(/\s+/)
  let ok = false
  if (/^basic$/i.test(scheme ?? "") && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8")
    const i = decoded.indexOf(":")
    if (i >= 0) {
      const okUser = safeEqual(decoded.slice(0, i), ctx.username)
      const okPass = safeEqual(decoded.slice(i + 1), ctx.password)
      ok = okUser && okPass
    }
  }
  if (!ok) {
    await ctx.onAuthFailure(listener, client.remoteAddress)
    client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Aether"\r\nConnection: close\r\n\r\n')
    return
  }
  const dest = parseConnectTarget(target ?? "")
  if (!dest || !ctx.upstreamPort) {
    client.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
    return
  }
  let up: { sock: net.Socket; rest: Buffer }
  try {
    up = await connectViaUpstream(ctx.upstreamPort, dest.host, dest.port)
  } catch {
    client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
    return
  }
  client.once("close", () => endAfterDrain(up.sock))
  const clientRest = reader.detach()
  client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
  if (up.rest.length) client.write(up.rest)
  if (clientRest.length) up.sock.write(clientRest)
  bridge(client, up.sock)
}

// ---------------------------------------------------------------------------------------------------------
// Shadowsocks AEAD
// ---------------------------------------------------------------------------------------------------------

const SS_SPECS: Record<SsCipher, { alg: string; keyLen: number; saltLen: number }> = {
  "chacha20-ietf-poly1305": { alg: "chacha20-poly1305", keyLen: 32, saltLen: 32 },
  "aes-256-gcm": { alg: "aes-256-gcm", keyLen: 32, saltLen: 32 },
  "aes-128-gcm": { alg: "aes-128-gcm", keyLen: 16, saltLen: 16 },
}
const TAG_LEN = 16
const MAX_CHUNK = 0x3fff

export function ssMasterKey(password: string, keyLen: number) {
  const pw = Buffer.from(password)
  const parts: Buffer[] = []
  let prev = Buffer.alloc(0)
  let total = 0
  while (total < keyLen) {
    prev = createHash("md5").update(Buffer.concat([prev, pw])).digest()
    parts.push(prev)
    total += prev.length
  }
  return Buffer.concat(parts).subarray(0, keyLen)
}

class Nonce {
  private n = Buffer.alloc(12)
  next() {
    const out = Buffer.from(this.n)
    for (let i = 0; i < 12; i++) {
      this.n[i] = (this.n[i] + 1) & 0xff
      if (this.n[i] !== 0) break
    }
    return out
  }
}

function aeadSeal(alg: string, key: Buffer, nonce: Buffer, data: Buffer) {
  const c = createCipheriv(alg as "aes-256-gcm", key, nonce, { authTagLength: TAG_LEN })
  return Buffer.concat([c.update(data), c.final(), c.getAuthTag()])
}

function aeadOpen(alg: string, key: Buffer, nonce: Buffer, data: Buffer) {
  const d = createDecipheriv(alg as "aes-256-gcm", key, nonce, { authTagLength: TAG_LEN })
  d.setAuthTag(data.subarray(data.length - TAG_LEN))
  return Buffer.concat([d.update(data.subarray(0, data.length - TAG_LEN)), d.final()])
}

export function createSsCodec(cipher: SsCipher, password: string) {
  const spec = SS_SPECS[cipher]
  const master = ssMasterKey(password, spec.keyLen)
  const subkey = (salt: Buffer) => Buffer.from(hkdfSync("sha1", master, salt, "ss-subkey", spec.keyLen))

  return {
    spec,
    decryptor() {
      let buf = Buffer.alloc(0)
      let key: Buffer | null = null
      const nonce = new Nonce()
      let need: number | null = null // payload length once the length chunk was read
      return {
        /** Returns decrypted payload pieces. Throws when authentication fails. */
        feed(chunk: Buffer): Buffer[] {
          buf = Buffer.concat([buf, chunk])
          const out: Buffer[] = []
          if (!key) {
            if (buf.length < spec.saltLen) return out
            key = subkey(buf.subarray(0, spec.saltLen))
            buf = buf.subarray(spec.saltLen)
          }
          for (;;) {
            if (need === null) {
              if (buf.length < 2 + TAG_LEN) break
              const len = aeadOpen(spec.alg, key, nonce.next(), buf.subarray(0, 2 + TAG_LEN))
              need = len.readUInt16BE(0) & MAX_CHUNK
              buf = buf.subarray(2 + TAG_LEN)
            }
            if (buf.length < need + TAG_LEN) break
            out.push(aeadOpen(spec.alg, key, nonce.next(), buf.subarray(0, need + TAG_LEN)))
            buf = buf.subarray(need + TAG_LEN)
            need = null
          }
          return out
        },
      }
    },
    encryptor() {
      const salt = randomBytes(spec.saltLen)
      const key = subkey(salt)
      const nonce = new Nonce()
      let sentSalt = false
      return {
        seal(data: Buffer): Buffer {
          const parts: Buffer[] = []
          if (!sentSalt) {
            parts.push(salt)
            sentSalt = true
          }
          for (let off = 0; off < data.length; off += MAX_CHUNK) {
            const piece = data.subarray(off, Math.min(off + MAX_CHUNK, data.length))
            const len = Buffer.alloc(2)
            len.writeUInt16BE(piece.length)
            parts.push(aeadSeal(spec.alg, key, nonce.next(), len), aeadSeal(spec.alg, key, nonce.next(), piece))
          }
          return Buffer.concat(parts)
        },
      }
    },
  }
}

/** Parses the SOCKS-style address that starts every Shadowsocks stream. null = need more bytes; throws on junk. */
export function parseSsAddress(buf: Buffer): { host: string; port: number; length: number } | null {
  if (buf.length < 1) return null
  const atyp = buf[0]
  let host: string
  let off: number
  if (atyp === 1) {
    if (buf.length < 7) return null
    host = [...buf.subarray(1, 5)].join(".")
    off = 5
  } else if (atyp === 3) {
    if (buf.length < 2) return null
    const len = buf[1]
    if (len === 0) throw new Error("bad address")
    if (buf.length < 2 + len + 2) return null
    host = buf.subarray(2, 2 + len).toString("utf8")
    off = 2 + len
  } else if (atyp === 4) {
    if (buf.length < 19) return null
    const groups: string[] = []
    for (let i = 0; i < 8; i++) groups.push(buf.readUInt16BE(1 + i * 2).toString(16))
    host = groups.join(":")
    off = 17
  } else {
    throw new Error("bad address type")
  }
  return { host, port: buf.readUInt16BE(off), length: off + 2 }
}

async function handleShadowsocks(client: net.Socket, listener: string, ctx: GatewayContext, reader: ReturnType<typeof socketReader>) {
  const codec = createSsCodec(ctx.ssCipher, ctx.password)
  const dec = codec.decryptor()
  const enc = codec.encryptor()
  const initial = reader.detach()

  let plain = Buffer.alloc(0)
  let upstream: net.Socket | null = null
  let connecting = false
  let dead = false
  const queue: Buffer[] = []

  const fail = async () => {
    if (dead) return
    dead = true
    client.pause()
    // Do not reveal anything to probes: stay silent for a random moment, then drop.
    await ctx.onAuthFailure(listener, client.remoteAddress)
    await sleep(randomInt(200, 1500))
    client.destroy()
    upstream?.destroy()
  }

  const toUpstream = (data: Buffer) => {
    if (!upstream) return queue.push(data)
    if (!upstream.write(data)) {
      client.pause()
      upstream.once("drain", () => client.resume())
    }
  }

  const open = async (host: string, port: number, rest: Buffer) => {
    connecting = true
    if (!ctx.upstreamPort) return client.destroy()
    try {
      const up = await connectViaUpstream(ctx.upstreamPort, host, port)
      if (dead || client.destroyed) return up.sock.destroy()
      upstream = up.sock
      armIdle(client)
      armIdle(up.sock)
      up.sock.on("error", () => {})
      // Flush what the client has not received yet before closing it.
      up.sock.on("close", () => endAfterDrain(client))
      up.sock.on("data", (d: Buffer | string) => {
        const chunk: Buffer = typeof d === "string" ? Buffer.from(d) : d
        if (!client.write(enc.seal(chunk))) {
          up.sock.pause()
          client.once("drain", () => up.sock.resume())
        }
      })
      up.sock.resume()
      if (up.rest.length) client.write(enc.seal(up.rest))
      if (rest.length) up.sock.write(rest)
      for (const q of queue.splice(0)) up.sock.write(q)
    } catch {
      client.destroy()
    }
  }

  const onChunk = (chunk: Buffer) => {
    if (dead) return
    let pieces: Buffer[]
    try {
      pieces = dec.feed(chunk)
    } catch {
      void fail()
      return
    }
    for (const p of pieces) {
      if (connecting) {
        toUpstream(p)
        continue
      }
      plain = Buffer.concat([plain, p])
      let addr: ReturnType<typeof parseSsAddress>
      try {
        addr = parseSsAddress(plain)
      } catch {
        void fail()
        return
      }
      if (addr) {
        const rest = plain.subarray(addr.length)
        void open(addr.host, addr.port, rest)
      }
    }
  }

  client.on("error", () => client.destroy())
  client.on("close", () => {
    if (upstream) endAfterDrain(upstream)
  })
  client.on("data", onChunk)
  if (initial.length) onChunk(Buffer.from(initial))
  client.resume()
  // If the client never completes the first chunk, drop it eventually.
  client.setTimeout(HANDSHAKE_TIMEOUT_MS * 2)
}

// ---------------------------------------------------------------------------------------------------------
// SOCKS5 (username/password) -> upstream SOCKS5 without auth
// ---------------------------------------------------------------------------------------------------------

async function handleSocks(client: net.Socket, listener: string, ctx: GatewayContext, reader: ReturnType<typeof socketReader>) {
  const upstreamPort = ctx.upstreamPort as number
  const [ver, nMethods] = await reader.read(2)
  const methods = await reader.read(nMethods)
  if (ver !== 5 || !methods.includes(0x02)) {
    client.end(Buffer.from([5, 0xff]))
    return
  }
  client.write(Buffer.from([5, 0x02]))

  const [authVer, uLen] = await reader.read(2)
  const user = await reader.read(uLen)
  const [pLen] = await reader.read(1)
  const pass = await reader.read(pLen)
  const okUser = safeEqual(user, ctx.username)
  const okPass = safeEqual(pass, ctx.password)
  if (authVer !== 1 || !okUser || !okPass) {
    await ctx.onAuthFailure(listener, client.remoteAddress)
    client.end(Buffer.from([1, 1]))
    return
  }

  const upstream = await connectUpstream(upstreamPort)
  client.once("close", () => endAfterDrain(upstream))
  upstream.on("error", () => {})
  const upReader = socketReader(upstream)
  upstream.write(Buffer.from([5, 1, 0]))
  const [upVer, upMethod] = await upReader.read(2)
  if (upVer !== 5 || upMethod !== 0) {
    upstream.destroy()
    client.end(Buffer.from([1, 1]))
    return
  }
  client.write(Buffer.from([1, 0]))

  const clientRest = reader.detach()
  const upstreamRest = upReader.detach()
  if (clientRest.length) upstream.write(clientRest)
  if (upstreamRest.length) client.write(upstreamRest)
  bridge(client, upstream)
}

// ---------------------------------------------------------------------------------------------------------
// Entry point + protocol sniffing
// ---------------------------------------------------------------------------------------------------------

export async function handleClient(client: net.Socket, listener: string, ctx: GatewayContext) {
  if (!ctx.upstreamPort) {
    client.destroy()
    return
  }
  // One timeout handler for the whole life of the socket: handshake timeout first, idle timeout later (armIdle).
  client.setTimeout(HANDSHAKE_TIMEOUT_MS)
  client.on("timeout", () => client.destroy())
  const reader = socketReader(client)
  const has = (p: GatewayProtocol) => ctx.protocols.includes(p)

  await reader.ensure(1)
  const first = reader.peek()[0]

  if (first === 0x43 && has("http")) {
    await reader.ensure(8)
    if (reader.peek().subarray(0, 8).toString("latin1") === "CONNECT ") return handleHttpConnect(client, listener, ctx, reader)
  }
  if (first === 0x05 && has("socks")) {
    await reader.ensure(2)
    const n = reader.peek()[1]
    // Real SOCKS5 clients offer 1-8 methods; a random Shadowsocks salt almost never looks like this.
    if (n >= 1 && n <= 8) {
      await reader.ensure(2 + n)
      const methods = reader.peek().subarray(2, 2 + n)
      if (methods.includes(0x02) || methods.includes(0x00)) return handleSocks(client, listener, ctx, reader)
    }
  }
  if (has("ss")) return handleShadowsocks(client, listener, ctx, reader)
  client.destroy()
}
