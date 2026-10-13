import { getFullStatus } from "@/lib/status"
import { saveShareSettings } from "@/lib/share"
import { parseShareSettings } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = parseShareSettings(body)
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 })
  }
  try {
    saveShareSettings(parsed.value)
    return Response.json(getFullStatus())
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 409 })
  }
}
