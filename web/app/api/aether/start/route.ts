import { startAether } from "@/lib/aether"
import { getFullStatus } from "@/lib/status"
import { parseOptions } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  try {
    startAether(parseOptions(body))
    return Response.json(getFullStatus())
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 409 })
  }
}
