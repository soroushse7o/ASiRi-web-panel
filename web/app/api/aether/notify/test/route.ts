import { notify } from "@/lib/notifier"
import { getApiLimiter, rateLimitResponse } from "@/lib/ratelimit"

export const dynamic = "force-dynamic"

export async function POST() {
  const limit = getApiLimiter().hit("notify-test")
  if (!limit.allowed) return rateLimitResponse(limit)
  const result = await notify("test", "✅ ASiRi panel: test notification")
  if (result.skipped === "no-channel") {
    return Response.json({ error: "No notification channel configured (NOTIFY_WEBHOOK_URL or NOTIFY_TELEGRAM_*)." }, { status: 409 })
  }
  return Response.json(result, { status: result.errors.length && !result.sent.length ? 502 : 200 })
}
