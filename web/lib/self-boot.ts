// Triggers lib/boot.ts from inside the route-handler bundle. instrumentation.ts runs in its own bundle, so it
// cannot safely share the tunnel state or import server-only modules; a tiny authenticated self-request does.
export function scheduleSelfBoot() {
  const user = process.env.PANEL_USER
  const pass = process.env.PANEL_PASSWORD
  if (!user || !pass) return
  const url = `http://127.0.0.1:${process.env.PORT || 3000}/api/aether/boot`
  const auth = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`
  let attempts = 0
  const timer = setInterval(async () => {
    attempts += 1
    try {
      const res = await fetch(url, { method: "POST", headers: { Authorization: auth }, signal: AbortSignal.timeout(5000) })
      if (res.ok || attempts >= 30) clearInterval(timer)
    } catch {
      if (attempts >= 30) clearInterval(timer)
    }
  }, 2000)
  timer.unref?.()
}
