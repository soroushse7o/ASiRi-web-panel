import { cancelBest } from "@/lib/bestconfig"
import { getFullStatus } from "@/lib/status"

export const dynamic = "force-dynamic"

export function POST() {
  cancelBest()
  return Response.json(getFullStatus())
}
