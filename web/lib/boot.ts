import "server-only"
import { findBinary, getRuntime, logLine, startAether } from "./aether"
import { loadConfig } from "./config-store"
import { DEFAULT_OPTIONS } from "./types"
import { startWatchdog } from "./watchdog"

const g = globalThis as unknown as { __aetherBooted?: boolean }

/** Starts the watchdog and, with AUTO_START=1, reconnects the tunnel using the persisted config. Idempotent. */
export function bootOnce(): { booted: boolean; started: boolean } {
  if (g.__aetherBooted) return { booted: false, started: false }
  g.__aetherBooted = true
  startWatchdog()

  const auto = ["1", "true"].includes((process.env.AUTO_START ?? "").toLowerCase())
  if (!auto || getRuntime().alive) return { booted: true, started: false }
  if (!findBinary()) {
    logLine("[boot] AUTO_START=1 but the Aether binary is missing; install it from the panel first", "warn")
    return { booted: true, started: false }
  }
  try {
    const options = loadConfig().options ?? DEFAULT_OPTIONS
    logLine("[boot] AUTO_START=1: starting the tunnel with the saved config")
    startAether(options, { persist: false })
    return { booted: true, started: true }
  } catch (err) {
    logLine(`[boot] auto-start failed: ${(err as Error).message}`, "error")
    return { booted: true, started: false }
  }
}
