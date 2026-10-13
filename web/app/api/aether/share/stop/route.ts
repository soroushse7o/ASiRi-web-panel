import { getFullStatus } from "@/lib/status"
import { stopShare } from "@/lib/share"

export const dynamic = "force-dynamic"

export async function POST() {
  await stopShare()
  return Response.json(getFullStatus())
}
