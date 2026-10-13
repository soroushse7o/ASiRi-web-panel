import { getBestStatus, startBest } from "@/lib/bestconfig"
import { getApiLimiter, rateLimitResponse } from "@/lib/ratelimit"
import { getFullStatus } from "@/lib/status"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const limit = getApiLimiter().hit("best")
  if (!limit.allowed) return rateLimitResponse(limit)
  const body = await req.json().catch(() => ({}))
  try {
    startBest(body)
    return Response.json(getFullStatus())
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 409 })
  }
}

export function GET() {
  return Response.json(getBestStatus(), { headers: { "Cache-Control": "no-store" } })
}
