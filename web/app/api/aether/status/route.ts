import { bootOnce } from "@/lib/boot"
import { getFullStatus } from "@/lib/status"

export const dynamic = "force-dynamic"

export function GET() {
  bootOnce() // safety net; instrumentation normally boots first
  return Response.json(getFullStatus(), { headers: { "Cache-Control": "no-store" } })
}
