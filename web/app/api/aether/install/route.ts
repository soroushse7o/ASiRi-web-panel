import { installAether } from "@/lib/install"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST() {
  try {
    return Response.json(await installAether())
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
