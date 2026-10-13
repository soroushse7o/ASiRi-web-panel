import "server-only"
import { findBinary, getRuntime, killAether, logLine, setMaintenance, setWanted, startAether } from "./aether"
import { loadConfig, saveConfig } from "./config-store"
import { probeSocks } from "./probe"
import { DEFAULT_OPTIONS, PROTOCOLS, SCAN_MODES, TRANSPORTS, type BestConfigStatus, type BestResult, type Protocol, type ScanMode, type StartOptions, type Transport } from "./types"

const CONNECT_TIMEOUT_MS = () => (Number(process.env.BEST_TIMEOUT_SEC) > 0 ? Number(process.env.BEST_TIMEOUT_SEC) : 45) * 1000
const SAMPLES = 3
/** Scan modes tried by default; the slow ones (verified / ironclad) can be requested explicitly. */
const DEFAULT_SCANS: ScanMode[] = ["turbo", "balanced"]

interface Job {
  status: BestConfigStatus
  cancel: boolean
}

const g = globalThis as unknown as { __aetherBest?: Job }
const job: Job = (g.__aetherBest ??= {
  cancel: false,
  status: { state: "idle", total: 0, done: 0, current: null, results: [], winner: null, startedAt: null, finishedAt: null, message: null },
})

export const getBestStatus = (): BestConfigStatus => job.status

export interface BestRequest {
  protocols?: Protocol[]
  transports?: Transport[]
  scans?: ScanMode[]
}

export function parseBestRequest(input: unknown): Required<BestRequest> {
  const o = (input ?? {}) as Record<string, unknown>
  const pick = <T extends string>(list: readonly T[], value: unknown, fallback: readonly T[]): T[] => {
    const v = Array.isArray(value) ? value.filter((x): x is T => list.includes(x as T)) : []
    return v.length ? v : [...fallback]
  }
  return {
    protocols: pick(PROTOCOLS, o.protocols, PROTOCOLS),
    transports: pick(TRANSPORTS, o.transports, TRANSPORTS),
    scans: pick(SCAN_MODES, o.scans, DEFAULT_SCANS),
  }
}

/** protocol × transport × scan. WireGuard has no transport, so it is tried once per scan mode. */
export function buildCandidates(req: Required<BestRequest>): { protocol: Protocol; transport: Transport; scan: ScanMode }[] {
  const out: { protocol: Protocol; transport: Transport; scan: ScanMode }[] = []
  for (const scan of req.scans) {
    for (const protocol of req.protocols) {
      const transports = protocol === "wg" ? ([req.transports[0]] as Transport[]) : req.transports
      for (const transport of transports) out.push({ protocol, transport, scan })
    }
  }
  return out
}

const label = (c: { protocol: Protocol; transport: Transport; scan: ScanMode }) =>
  c.protocol === "wg" ? `wg · ${c.scan}` : `${c.protocol} · ${c.transport} · ${c.scan}`

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function waitConnected(timeoutMs: number): Promise<number | null> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (job.cancel) return null
    const rt = getRuntime()
    if (rt.phase === "connected") return Date.now() - started
    if (!rt.alive) return null
    await sleep(500)
  }
  return null
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

async function tryCandidate(base: StartOptions, c: { protocol: Protocol; transport: Transport; scan: ScanMode }): Promise<BestResult> {
  const result: BestResult = { label: label(c), ...c, ok: false, latencyMs: null, connectMs: null, error: null }
  const options: StartOptions = { ...base, ...c }
  try {
    startAether(options, { persist: false })
    const connectMs = await waitConnected(CONNECT_TIMEOUT_MS())
    if (connectMs === null) {
      result.error = job.cancel ? "cancelled" : "did not connect in time"
      return result
    }
    result.connectMs = connectMs
    const times: number[] = []
    for (let i = 0; i < SAMPLES && !job.cancel; i++) {
      const probe = await probeSocks(options.port, 10)
      if (probe.ok) times.push(probe.ms)
      else result.error = probe.error ?? "probe failed"
    }
    if (times.length) {
      result.ok = true
      result.latencyMs = median(times)
      result.error = null
    }
  } catch (err) {
    result.error = (err as Error).message
  } finally {
    await killAether()
  }
  return result
}

export function cancelBest() {
  if (job.status.state === "running") job.cancel = true
}

export function startBest(input: unknown): void {
  if (job.status.state === "running") throw new Error("جستجوی بهترین کانفیگ در حال اجراست.")
  if (!findBinary()) throw new Error("فایل اجرایی Aether پیدا نشد. ابتدا آن را نصب کنید.")
  const rt = getRuntime()
  if (rt.phase === "starting" || rt.phase === "scanning" || rt.phase === "connecting") {
    throw new Error("تونل در حال اتصال است؛ کمی بعد دوباره تلاش کنید.")
  }

  const candidates = buildCandidates(parseBestRequest(input))
  const config = loadConfig()
  const base: StartOptions = rt.options ?? config.options ?? DEFAULT_OPTIONS
  const wasRunning = rt.wanted

  job.cancel = false
  job.status = {
    state: "running",
    total: candidates.length,
    done: 0,
    current: null,
    results: [],
    winner: null,
    startedAt: Date.now(),
    finishedAt: null,
    message: null,
  }
  setMaintenance(true)
  void run(base, candidates, wasRunning).catch((err: Error) => {
    job.status = { ...job.status, state: "failed", finishedAt: Date.now(), message: err.message }
    setMaintenance(false)
  })
}

async function run(base: StartOptions, candidates: ReturnType<typeof buildCandidates>, wasRunning: boolean) {
  logLine(`[best] testing ${candidates.length} configurations`)
  await killAether()
  for (const c of candidates) {
    if (job.cancel) break
    job.status = { ...job.status, current: label(c) }
    const result = await tryCandidate(base, c)
    job.status = { ...job.status, done: job.status.done + 1, results: [...job.status.results, result] }
    logLine(`[best] ${result.label}: ${result.ok ? `${result.latencyMs}ms` : (result.error ?? "failed")}`)
  }

  const ok = job.status.results.filter((r) => r.ok && r.latencyMs !== null)
  ok.sort((a, b) => (a.latencyMs! - b.latencyMs!) || ((a.connectMs ?? 0) - (b.connectMs ?? 0)))
  const winner = ok[0] ?? null
  const cancelled = job.cancel

  let next: StartOptions | null = null
  let message: string
  if (winner && !cancelled) {
    next = { ...base, protocol: winner.protocol, transport: winner.transport, scan: winner.scan }
    const preset = { options: next, latencyMs: winner.latencyMs, at: Date.now() }
    saveConfig({ options: next, best: preset, lastGood: preset })
    message = `Best: ${winner.label} (${winner.latencyMs}ms)`
  } else if (winner && cancelled) {
    message = `Cancelled. Best so far: ${winner.label} (${winner.latencyMs}ms) — not applied.`
  } else {
    // Nothing worked: fall back to the last known-good preset instead of leaving the tunnel on a failing one.
    next = loadConfig().lastGood?.options ?? base
    if (!cancelled) saveConfig({ options: next })
    message = cancelled ? "Cancelled." : "No configuration connected; falling back to the last known-good preset."
  }
  logLine(`[best] ${message}`)

  job.status = {
    ...job.status,
    state: cancelled ? "cancelled" : winner ? "done" : "failed",
    current: null,
    winner: cancelled ? null : winner,
    finishedAt: Date.now(),
    message,
  }
  setMaintenance(false)
  if (!wasRunning) setWanted(false) // candidates set `wanted`; do not let the watchdog revive a tunnel the user never started

  const restore = cancelled && !winner ? base : next
  if (wasRunning && restore) {
    try {
      startAether(restore, { persist: false })
    } catch (err) {
      logLine(`[best] could not restart the tunnel: ${(err as Error).message}`, "error")
    }
  }
}
