import { getProxyPort } from "@/lib/aether"
import { getFullStatus } from "@/lib/status"
import { startShare } from "@/lib/share"

export const dynamic = "force-dynamic"

export async function POST() {
  const port = getProxyPort()
  if (!port) {
    return Response.json({ error: "ابتدا تونل را وصل کنید." }, { status: 409 })
  }
  try {
    await startShare(port)
    return Response.json(getFullStatus())
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
