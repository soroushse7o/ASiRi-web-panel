// Production entry point: `next start` equivalent that also lets the panel accept WebSocket upgrades
// (VLESS / Trojan inbound) on the same HTTP port, so Railway's edge (443) can carry them.
// Everything else is served by Next.js unchanged (Basic Auth proxy, API routes, ...).
import { createServer } from "node:http"
import next from "next"

const dev = process.env.NODE_ENV !== "production"
const port = Number(process.env.PORT) || 3000
const hostname = process.env.HOSTNAME_BIND || "0.0.0.0"

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()
await app.prepare()

const server = createServer((req, res) => {
  handle(req, res).catch(() => {
    res.statusCode = 500
    res.end("Internal Server Error")
  })
})

// Claim upgrade requests before anything else sees them. share.ts publishes the hook on globalThis; it only claims
// the inbound's own path. In production every other upgrade is refused; in dev Next's HMR socket still works.
const emit = server.emit.bind(server)
server.emit = (event, ...args) => {
  if (event === "upgrade") {
    const [req, socket, head] = args
    socket.on("error", () => socket.destroy())
    let claimed = false
    try {
      const hook = globalThis.__aetherWsUpgrade
      claimed = typeof hook === "function" && hook(req, socket, head) === true
    } catch {
      claimed = false
    }
    if (claimed) return true
    if (!dev) {
      // Answer with a real HTTP response instead of an abrupt TCP drop.
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
      const t = setTimeout(() => socket.destroy(), 2000)
      t.unref?.()
      socket.once("close", () => clearTimeout(t))
      return true
    }
  }
  return emit(event, ...args)
}

server.listen(port, hostname, () => {
  console.log(`> ASiRi panel ready on http://${hostname}:${port}`)
})
