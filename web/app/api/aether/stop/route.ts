import { stopAether } from "@/lib/aether"
import { getFullStatus } from "@/lib/status"

export const dynamic = "force-dynamic"

export async function POST() {
  await stopAether()
  return Response.json(getFullStatus())
}
