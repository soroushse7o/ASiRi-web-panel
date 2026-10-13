import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)

export interface ProbeResult {
  ok: boolean
  ms: number
  error?: string
}

/** One request to Cloudflare's trace endpoint through the local SOCKS5 port. Used by the watchdog and best-config. */
export async function probeSocks(port: number, timeoutSec = 10): Promise<ProbeResult> {
  const started = Date.now()
  try {
    await run(
      "curl",
      [
        "-sS",
        "-f",
        "--max-time",
        String(timeoutSec),
        "--socks5-hostname",
        `127.0.0.1:${port}`,
        "-o",
        "/dev/null",
        "https://www.cloudflare.com/cdn-cgi/trace",
      ],
      { timeout: (timeoutSec + 5) * 1000 },
    )
    return { ok: true, ms: Date.now() - started }
  } catch (err) {
    const message = (err as { stderr?: string }).stderr?.trim() || (err as Error).message
    return { ok: false, ms: Date.now() - started, error: message.slice(0, 200) }
  }
}
