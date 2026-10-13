import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { getStatus } from "@/lib/aether"
import type { TraceResult } from "@/lib/types"

export const dynamic = "force-dynamic"

const run = promisify(execFile)

export async function POST() {
  const status = getStatus()
  if (status.phase !== "connected" || !status.options) {
    return Response.json({ ok: false, error: "تونل هنوز متصل نیست" } satisfies TraceResult, { status: 409 })
  }

  const started = Date.now()
  try {
    const { stdout } = await run(
      "curl",
      [
        "-sS",
        "--max-time",
        "15",
        "--socks5-hostname",
        `127.0.0.1:${status.options.port}`,
        "https://www.cloudflare.com/cdn-cgi/trace",
      ],
      { timeout: 20000 },
    )
    const fields = Object.fromEntries(
      stdout
        .split("\n")
        .map((line) => line.split("="))
        .filter((pair) => pair.length === 2),
    )
    return Response.json({
      ok: true,
      ip: fields.ip,
      loc: fields.loc,
      colo: fields.colo,
      warp: fields.warp,
      ms: Date.now() - started,
    } satisfies TraceResult)
  } catch (err) {
    const message = (err as { stderr?: string }).stderr?.trim() || (err as Error).message
    return Response.json({ ok: false, error: message } satisfies TraceResult, { status: 502 })
  }
}
