import "server-only"
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { saveOptions } from "./config-store"
import { autoStartShare, getShareStatus, stopShare } from "./share"
import type { AetherStatus, ExitInfo, LogLine, Phase, StartOptions } from "./types"

// Serverless deployments expose /var/task as the working directory, which is read-only.
// Always keep the downloaded binary and runtime files in the writable OS temp directory.
export const AETHER_DIR = path.join(os.tmpdir(), ".aether")

const MAX_LOGS = 500
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

interface State {
  proc: ChildProcess | null
  phase: Phase
  logs: LogLine[]
  seq: number
  startedAt: number | null
  connectedAt: number | null
  options: StartOptions | null
  gateway: string | null
  exit: ExitInfo | null
  lastError: string | null
  stopRequested: boolean
  shareAutoTried: boolean
  /** The user (or AUTO_START) wants the tunnel up; the watchdog keeps it alive while true. */
  wanted: boolean
  /** Set while best-config sweeps candidates, so the watchdog stays out of the way. */
  maintenance: boolean
}

const globalForAether = globalThis as unknown as { __aether?: State }

const state: State = (globalForAether.__aether ??= {
  proc: null,
  phase: "stopped",
  logs: [],
  seq: 0,
  startedAt: null,
  connectedAt: null,
  options: null,
  gateway: null,
  exit: null,
  lastError: null,
  stopRequested: false,
  shareAutoTried: false,
  wanted: false,
  maintenance: false,
})

export function findBinary(): string | null {
  const candidates = [process.env.AETHER_BIN, path.join(AETHER_DIR, "aether"), "/tmp/aether/aether"]
  return candidates.find((p): p is string => Boolean(p) && existsSync(p as string)) ?? null
}

export function logLine(text: string, level: LogLine["level"] = "info") {
  pushLog(text, level)
}

function pushLog(text: string, level: LogLine["level"] = "info") {
  state.seq += 1
  state.logs.push({ id: state.seq, text, level, ts: Date.now() })
  if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS)
}

function parseLine(raw: string) {
  const text = raw.replace(ANSI, "").trimEnd()
  if (!text) return

  const level: LogLine["level"] = /\bERROR\b/.test(text) ? "error" : /\bWARN\b/.test(text) ? "warn" : "info"
  pushLog(text, level)

  if (/scan mode=/.test(text)) state.phase = "scanning"

  const edge = text.match(/using cloudflare edge (\S+)/) ?? text.match(/selected \S+ gateway (\S+)/)
  if (edge) {
    state.gateway = edge[1]
    if (state.phase !== "connected") state.phase = "connecting"
  }

  if (/socks5 server listening on/.test(text)) {
    state.phase = "connected"
    state.connectedAt = Date.now()
    state.lastError = null
    if (!state.shareAutoTried && state.options) {
      state.shareAutoTried = true
      autoStartShare(state.options.port)
    }
  }

  const exit = text.match(/exit: ([0-9a-fA-F.:]+), (\w+) via (\w+), (\d+)ms to cloudflare(?:, warp (\w+))?/)
  if (exit) {
    state.exit = {
      ip: exit[1],
      country: exit[2],
      colo: exit[3],
      latencyMs: Number(exit[4]),
      warp: exit[5] ?? null,
    }
  }

  if (/tunnel ended|reconnecting/.test(text)) {
    state.phase = "reconnecting"
    state.connectedAt = null
  }

  if (level === "error") state.lastError = text.replace(/^\[[^\]]*\]\s*/, "")
}

function attachStream(stream: NodeJS.ReadableStream | null) {
  if (!stream) return
  let buffer = ""
  stream.setEncoding("utf8")
  stream.on("data", (chunk: string) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ""
    lines.forEach(parseLine)
  })
  stream.on("end", () => {
    if (buffer) parseLine(buffer)
    buffer = ""
  })
}

export function buildArgs(o: StartOptions): string[] {
  const args = ["--protocol", o.protocol, "--scan", o.scan]
  args.push(o.ip === "4" ? "-4" : o.ip === "6" ? "-6" : "--dual")
  if (o.protocol !== "wg") args.push(o.transport === "h2" ? "--h2" : "--h3")
  if (o.noize !== "default") args.push("--noize", o.noize)
  args.push("--bind", `127.0.0.1:${o.port}`)
  if (o.httpProxy) args.push("--http-proxy", `127.0.0.1:${o.port + 1}`)
  args.push(o.quickReconnect ? "--quick-reconnect" : "--no-quick-reconnect")
  return args
}

export function startAether(options: StartOptions, opts: { persist?: boolean } = {}) {
  if (state.proc) throw new Error("Aether در حال اجراست. ابتدا آن را متوقف کنید.")
  const bin = findBinary()
  if (!bin) throw new Error("فایل اجرایی Aether پیدا نشد. ابتدا آن را نصب کنید.")

  mkdirSync(AETHER_DIR, { recursive: true })
  const args = buildArgs(options)

  state.wanted = true
  if (opts.persist !== false) saveOptions(options)

  state.logs = []
  state.phase = "starting"
  state.startedAt = Date.now()
  state.connectedAt = null
  state.options = options
  state.gateway = null
  state.exit = null
  state.lastError = null
  state.stopRequested = false
  state.shareAutoTried = false
  pushLog(`$ aether ${args.join(" ")}`)

  const proc = spawn(bin, args, {
    cwd: AETHER_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
  })
  state.proc = proc
  attachStream(proc.stdout)
  attachStream(proc.stderr)

  proc.on("error", (err) => {
    pushLog(`failed to start: ${err.message}`, "error")
    state.lastError = err.message
    state.phase = "error"
    state.proc = null
  })

  proc.on("exit", (code, signal) => {
    if (state.proc !== proc) return
    state.proc = null
    state.connectedAt = null
    if (state.stopRequested) {
      state.phase = "stopped"
      pushLog("[*] aether stopped")
    } else {
      state.phase = "error"
      state.lastError ??= `Aether با کد ${code ?? signal} بسته شد`
      pushLog(`[-] aether exited (code=${code ?? "null"} signal=${signal ?? "none"})`, "error")
    }
  })
}

export function getProxyPort(): number | null {
  return state.phase === "connected" && state.options ? state.options.port : null
}

export async function stopAether(): Promise<void> {
  state.wanted = false
  await stopShare()
  const proc = state.proc
  if (!proc) {
    state.phase = "stopped"
    return Promise.resolve()
  }
  state.stopRequested = true
  return new Promise((resolve) => {
    const killTimer = setTimeout(() => proc.kill("SIGKILL"), 3000)
    proc.once("exit", () => {
      clearTimeout(killTimer)
      resolve()
    })
    proc.kill("SIGTERM")
  })
}

/** Stops only the Aether process (keeps `wanted` and the share relay). Used for watchdog restarts and best-config. */
export function killAether(): Promise<void> {
  const proc = state.proc
  if (!proc) return Promise.resolve()
  state.stopRequested = true
  return new Promise((resolve) => {
    const killTimer = setTimeout(() => proc.kill("SIGKILL"), 3000)
    proc.once("exit", () => {
      clearTimeout(killTimer)
      resolve()
    })
    proc.kill("SIGTERM")
  })
}

export function setWanted(value: boolean) {
  state.wanted = value
}

export function setMaintenance(value: boolean) {
  state.maintenance = value
}

/** Cheap snapshot for the watchdog / best-config (no logs, no share status). */
export function getRuntime() {
  return {
    wanted: state.wanted,
    maintenance: state.maintenance,
    alive: Boolean(state.proc),
    phase: state.phase,
    options: state.options,
    uptimeSec: state.connectedAt ? Math.floor((Date.now() - state.connectedAt) / 1000) : null,
  }
}

export function getStatus(): Omit<AetherStatus, "savedOptions" | "autoStart" | "persistence" | "watchdog" | "bestConfig" | "lastGood" | "notify"> {
  const now = Date.now()
  return {
    binary: findBinary(),
    running: Boolean(state.proc),
    phase: state.phase,
    pid: state.proc?.pid ?? null,
    options: state.options,
    gateway: state.gateway,
    exit: state.exit,
    lastError: state.lastError,
    uptimeSec: state.connectedAt ? Math.floor((now - state.connectedAt) / 1000) : null,
    runningSec: state.startedAt && state.proc ? Math.floor((now - state.startedAt) / 1000) : null,
    logs: state.logs.slice(-250),
    share: getShareStatus(),
  }
}
