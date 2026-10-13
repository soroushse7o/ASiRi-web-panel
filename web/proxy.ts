import { NextResponse, type NextRequest } from "next/server"
import { RateLimiter } from "./lib/ratelimit"

// Basic Auth gate for the whole panel and every /api/aether/* route.
// Fails closed: if PANEL_USER / PANEL_PASSWORD are not set, nothing is served.

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Failed-login throttle per client IP: 20 bad attempts in 10 minutes block that IP for 10 minutes.
const g = globalThis as unknown as { __aetherPanelAuth?: RateLimiter }
const authFails = (g.__aetherPanelAuth ??= new RateLimiter({ max: 20, windowMs: 600_000, blockMs: 600_000 }))

function clientIp(req: NextRequest) {
  // Behind Railway / Render the last X-Forwarded-For entry is the one added by the platform proxy.
  const real = req.headers.get("x-real-ip")
  if (real) return real.trim()
  const forwarded = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  return forwarded.at(-1) ?? "unknown"
}

export function proxy(req: NextRequest) {
  // Unauthenticated health check for Render / Railway.
  if (req.nextUrl.pathname === "/healthz") return new NextResponse("ok")

  const user = process.env.PANEL_USER
  const pass = process.env.PANEL_PASSWORD
  if (!user || !pass) {
    return new NextResponse("PANEL_USER and PANEL_PASSWORD must be set", { status: 503 })
  }

  const ip = clientIp(req)
  const gate = authFails.check(ip)
  if (!gate.allowed) {
    return new NextResponse("Too many failed attempts", {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(gate.retryAfterMs / 1000)) },
    })
  }

  const [scheme, encoded] = (req.headers.get("authorization") ?? "").split(" ")
  if (scheme === "Basic" && encoded) {
    try {
      const decoded = atob(encoded)
      const i = decoded.indexOf(":")
      if (i >= 0 && safeEqual(decoded.slice(0, i), user) && safeEqual(decoded.slice(i + 1), pass)) {
        authFails.reset(ip)
        return NextResponse.next()
      }
    } catch {
      // fall through to 401
    }
  }

  // The first request of a browser carries no credentials at all; only wrong credentials count as a failure.
  if (encoded) authFails.hit(ip)

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ASiRi", charset="UTF-8"' },
  })
}

export const config = { matcher: "/:path*" }
