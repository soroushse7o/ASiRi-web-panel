import "server-only"
import { getRuntime, killAether, logLine, startAether } from "./aether"
import { loadConfig, sameOptions, saveConfig } from "./config-store"
import { notify } from "./notifier"
import { probeSocks } from "./probe"
import { getExternalProbeTarget } from "./share"
import { probeExternalWs } from "./wsprobe"
import { backoffMs } from "./ratelimit"
import type { StartOptions, WatchdogStatus } from "./types"

const num = (name: string, fallback: number) => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const tuning = () => ({
  tickMs: num("WATCHDOG_TICK_SEC", 5) * 1000,
  checkMs: num("WATCHDOG_INTERVAL_SEC", 30) * 1000,
  maxFailures: Math.floor(num("WATCHDOG_MAX_FAILURES", 3)),
  stuckMs: num("WATCHDOG_STUCK_SEC", 300) * 1000,
  stableMs: num("WATCHDOG_STABLE_SEC", 60) * 1000,
  fallbackAfter: Math.floor(num("WATCHDOG_FALLBACK_AFTER", 3)),
  backoffBaseMs: num("WATCHDOG_BACKOFF_BASE_SEC", 2) * 1000,
  backoffMaxMs: num("WATCHDOG_BACKOFF_MAX_SEC", 300) * 1000,
  probeTimeoutSec: num("WATCHDOG_PROBE_TIMEOUT_SEC", 10),
})

interface Wd {
  timer: ReturnType<typeof setInterval> | null
  busy: boolean
  consecutiveFails: number
  restarts: number
  /** Failed restarts in a row without ever reaching "connected". */
  failedStarts: number
  backoffIdx: number
  nextRestartAt: number | null
  nextReason: string | null
  lastCheckAt: number | null
  lastCheckOk: boolean | null
  lastReason: string | null
  stuckSince: number | null
  connectedSince: number | null
  downNotified: boolean
  goodSaved: boolean
}

const g = globalThis as unknown as { __aetherWatchdog?: Wd }
const wd: Wd = (g.__aetherWatchdog ??= {
  timer: null,
  busy: false,
  consecutiveFails: 0,
  restarts: 0,
  failedStarts: 0,
  backoffIdx: 0,
  nextRestartAt: null,
  nextReason: null,
  lastCheckAt: null,
  lastCheckOk: null,
  lastReason: null,
  stuckSince: null,
  connectedSince: null,
  downNotified: false,
  goodSaved: false,
})

function resetIdle() {
  wd.consecutiveFails = 0
  wd.failedStarts = 0
  wd.backoffIdx = 0
  wd.nextRestartAt = null
  wd.nextReason = null
  wd.stuckSince = null
  wd.connectedSince = null
  wd.downNotified = false
  wd.goodSaved = false
}

function reportDown(reason: string, delayMs: number) {
  wd.lastReason = reason
  logLine(`[watchdog] ${reason}; restarting in ${Math.round(delayMs / 1000)}s (attempt ${wd.backoffIdx + 1})`, "warn")
  if (!wd.downNotified) {
    wd.downNotified = true
    void notify("tunnel_down", `🔴 Tunnel down: ${reason}. Restarting in ${Math.round(delayMs / 1000)}s.`, { key: "down" })
  }
}

function scheduleRestart(reason: string) {
  const t = tuning()
  const delay = backoffMs(wd.backoffIdx, t.backoffBaseMs, t.backoffMaxMs)
  wd.nextRestartAt = Date.now() + delay
  wd.nextReason = reason
  reportDown(reason, delay)
  wd.backoffIdx += 1
}

async function restartNow(options: StartOptions) {
  wd.restarts += 1
  wd.nextRestartAt = null
  wd.stuckSince = null
  wd.connectedSince = null
  wd.consecutiveFails = 0
  await killAether()
  try {
    startAether(options, { persist: false })
  } catch (err) {
    logLine(`[watchdog] restart failed: ${(err as Error).message}`, "error")
    scheduleRestart(`restart failed: ${(err as Error).message}`)
  }
}

/** After repeated failed starts, switch to the last known-good preset (if it differs from the failing one). */
async function maybeFallback(current: StartOptions | null): Promise<StartOptions | null> {
  const t = tuning()
  if (wd.failedStarts < t.fallbackAfter) return null
  const good = loadConfig().lastGood
  if (!good || sameOptions(good.options, current)) return null
  logLine("[watchdog] repeated failures; falling back to the last known-good preset", "warn")
  void notify("tunnel_down", `🟠 ${wd.failedStarts} failed starts in a row; falling back to the last known-good preset.`, {
    key: "fallback",
  })
  saveConfig({ options: good.options })
  wd.failedStarts = 0
  wd.backoffIdx = 0
  return good.options
}

async function tick() {
  const t = tuning()
  const rt = getRuntime()
  if (!rt.wanted || rt.maintenance) {
    if (!rt.wanted) resetIdle()
    return
  }
  const now = Date.now()

  if (!rt.alive) {
    if (wd.nextRestartAt === null) {
      if (!wd.connectedSince || now - wd.connectedSince < t.stableMs) wd.failedStarts += 1
      wd.connectedSince = null
      scheduleRestart("Aether process exited")
    }
    if (wd.nextRestartAt !== null && now >= wd.nextRestartAt && rt.options) {
      const fallback = await maybeFallback(rt.options)
      await restartNow(fallback ?? rt.options)
    }
    return
  }

  if (rt.phase === "connected") {
    wd.stuckSince = null
    wd.connectedSince ??= now
    if (wd.downNotified && now - wd.connectedSince > 10_000) wd.downNotified = false

    if (now - wd.connectedSince >= t.stableMs) {
      wd.failedStarts = 0
      wd.backoffIdx = 0
      if (!wd.goodSaved && rt.options) {
        wd.goodSaved = true
        saveConfig({ lastGood: { options: rt.options, latencyMs: null, at: Date.now() } })
      }
    }

    if (rt.options && (wd.lastCheckAt === null || now - wd.lastCheckAt >= t.checkMs)) {
      wd.lastCheckAt = now
      // Prefer the external path (public WS endpoint, no loopback); use the local SOCKS probe only while sharing is off.
      const external = getExternalProbeTarget()
      const probe = external ? await probeExternalWs(external, t.probeTimeoutSec) : await probeSocks(rt.options.port, t.probeTimeoutSec)
      wd.lastCheckOk = probe.ok
      if (probe.ok) {
        wd.consecutiveFails = 0
      } else {
        wd.consecutiveFails += 1
        logLine(`[watchdog] health check failed (${wd.consecutiveFails}/${t.maxFailures}): ${probe.error ?? "unknown"}`, "warn")
        if (wd.consecutiveFails >= t.maxFailures) {
          wd.failedStarts += 1
          const delay = backoffMs(wd.backoffIdx, t.backoffBaseMs, t.backoffMaxMs)
          reportDown(`${wd.consecutiveFails} consecutive health checks failed`, delay)
          wd.backoffIdx += 1
          await killAether()
          wd.nextRestartAt = Date.now() + delay
          wd.nextReason = "health checks failed"
        }
      }
    }
    return
  }

  // Alive but not connected (scanning / connecting / reconnecting): Aether handles short blips by itself.
  wd.connectedSince = null
  wd.stuckSince ??= now
  if (now - wd.stuckSince > t.stuckMs) {
    wd.failedStarts += 1
    wd.stuckSince = null
    const delay = backoffMs(wd.backoffIdx, t.backoffBaseMs, t.backoffMaxMs)
    reportDown(`stuck in "${rt.phase}" for over ${Math.round(t.stuckMs / 1000)}s`, delay)
    wd.backoffIdx += 1
    await killAether()
    wd.nextRestartAt = Date.now() + delay
    wd.nextReason = "stuck"
  }
}

export function startWatchdog() {
  if (wd.timer) return
  wd.timer = setInterval(() => {
    if (wd.busy) return
    wd.busy = true
    tick()
      .catch((err: Error) => logLine(`[watchdog] ${err.message}`, "error"))
      .finally(() => {
        wd.busy = false
      })
  }, tuning().tickMs)
  wd.timer.unref?.()
}

export function getWatchdogStatus(): WatchdogStatus {
  return {
    enabled: wd.timer !== null,
    consecutiveFailures: wd.consecutiveFails,
    maxFailures: tuning().maxFailures,
    restarts: wd.restarts,
    nextRestartInSec: wd.nextRestartAt ? Math.max(0, Math.ceil((wd.nextRestartAt - Date.now()) / 1000)) : null,
    lastCheckAt: wd.lastCheckAt,
    lastCheckOk: wd.lastCheckOk,
    lastReason: wd.lastReason,
  }
}
