import "server-only"
import { randomBytes } from "node:crypto"
import net from "node:net"
import tls from "node:tls"
import { encodeFrame, type InboundIdentity } from "./inbound"
import type { ProbeResult } from "./probe"

// External watchdog probe: a real end-to-end request through the PUBLIC WebSocket endpoint
// (edge -> panel inbound -> gateway upstream -> tunnel -> internet). It never touches 127.0.0.1.

export interface WsProbeTarget {
  host: string
  port: number
  tls: boolean
  path: string
  protocol: "vless" | "trojan"
  ident: InboundIdentity
}

const DEST_HOST = "www.cloudflare.com"
const REQUEST = `GET /cdn-cgi/trace HTTP/1.1\r\nHost: ${DEST_HOST}\r\nConnection: close\r\nUser-Agent: aether-watchdog\r\n\r\n`

function header(t: WsProbeTarget): Buffer {
  const host = Buffer.from(DEST_HOST)
  if (t.protocol === "vless") {
    return Buffer.concat([
      Buffer.from([0]),
      Buffer.from(t.ident.uuid.replace(/-/g, ""), "hex"),
      Buffer.from([0, 1, 0, 80, 2, host.length]),
      host,
    ])
  }
  return Buffer.concat([Buffer.from(t.ident.trojanHash, "latin1"), Buffer.from("\r\n"), Buffer.from([1, 3, host.length]), host, Buffer.from([0, 80]), Buffer.from("\r\n")])
}

/** Client frames must be masked (RFC 6455). */
function maskedFrame(opcode: number, payload: Buffer): Buffer {
  const plain = encodeFrame(opcode, payload)
  const headLen = plain.length - payload.length
  const mask = randomBytes(4)
  const head = Buffer.from(plain.subarray(0, headLen))
  head[1] |= 0x80
  const body = Buffer.from(payload)
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3]
  return Buffer.concat([head, mask, body])
}

export function probeExternalWs(t: WsProbeTarget, timeoutSec = 10): Promise<ProbeResult> {
  const started = Date.now()
  return new Promise<ProbeResult>((resolve) => {
    let done = false
    let sock: net.Socket
    const finish = (ok: boolean, error?: string) => {
      if (done) return
      done = true
      clearTimeout(timer)
      sock?.destroy()
      resolve({ ok, ms: Date.now() - started, ...(ok ? {} : { error: (error ?? "failed").slice(0, 200) }) })
    }
    const timer = setTimeout(() => finish(false, "external WS probe timeout"), timeoutSec * 1000)
    timer.unref?.()

    const key = randomBytes(16).toString("base64")
    const opts = { host: t.host, port: t.port }
    sock = t.tls ? tls.connect({ ...opts, servername: t.host }) : net.connect(opts)
    sock.on("error", (e) => finish(false, e.message))
    sock.on("close", () => finish(false, "connection closed before a response"))

    let upgraded = false
    let raw = Buffer.alloc(0)
    let text = ""
    let gotReply = t.protocol === "trojan" // VLESS answers with a 2-byte header first

    // The inbound's frames are unmasked (server -> client), so decode them with a tiny reader of our own.
    let fbuf = Buffer.alloc(0)
    const readServerFrames = (chunk: Buffer) => {
      fbuf = Buffer.concat([fbuf, chunk])
      for (;;) {
        if (fbuf.length < 2) return
        const opcode = fbuf[0] & 0x0f
        let len = fbuf[1] & 0x7f
        let off = 2
        if (len === 126) {
          if (fbuf.length < 4) return
          len = fbuf.readUInt16BE(2)
          off = 4
        } else if (len === 127) {
          if (fbuf.length < 10) return
          len = Number(fbuf.readBigUInt64BE(2))
          off = 10
        }
        if (fbuf.length < off + len) return
        const payload = fbuf.subarray(off, off + len)
        fbuf = fbuf.subarray(off + len)
        if (opcode === 9) sock.write(maskedFrame(10, payload))
        else if (opcode === 8) return finish(false, "server closed the WebSocket")
        else if (opcode === 2 || opcode === 0) {
          let data = payload
          if (!gotReply) {
            if (data.length < 2 || data[0] !== 0) return finish(false, "bad VLESS response header")
            gotReply = true
            data = data.subarray(2)
          }
          text += data.toString("latin1")
          if (/^HTTP\/1\.[01] 200/.test(text)) return finish(true)
          if (text.length > 12 && !text.startsWith("HTTP/")) return finish(false, "unexpected response")
        }
      }
    }

    sock.once(t.tls ? "secureConnect" : "connect", () => {
      sock.write(
        `GET ${t.path} HTTP/1.1\r\nHost: ${t.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      )
    })
    sock.on("data", (d: Buffer) => {
      if (upgraded) return readServerFrames(d)
      raw = Buffer.concat([raw, d])
      const end = raw.indexOf("\r\n\r\n")
      if (end < 0) {
        if (raw.length > 8192) finish(false, "oversized upgrade response")
        return
      }
      const status = raw.subarray(0, raw.indexOf("\r\n")).toString("latin1")
      if (!/^HTTP\/1\.1 101/.test(status)) return finish(false, `upgrade refused: ${status}`)
      upgraded = true
      sock.write(maskedFrame(2, Buffer.concat([header(t), Buffer.from(REQUEST)])))
      const rest = raw.subarray(end + 4)
      if (rest.length) readServerFrames(rest)
    })
  })
}
