// Persisted tunnel config (protocol, transport, scan, …) + detection of whether TMPDIR is on a mounted volume.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseOptions, type PersistenceInfo, type SavedPreset, type StartOptions } from "./types"

/** Same directory aether.ts / share.ts use. Evaluated lazily so TMPDIR changes are honoured. */
export const dataDir = () => path.join(os.tmpdir(), ".aether")
const configFile = () => path.join(dataDir(), "tunnel-config.json")

export interface TunnelConfig {
  version: 1
  /** Options of the last tunnel start; used by AUTO_START and to prefill the form. */
  options: StartOptions | null
  /** Last preset that stayed connected for a while (fallback target). */
  lastGood: SavedPreset | null
  /** Winner of the last "Find best config" run. */
  best: SavedPreset | null
  updatedAt: number
}

const EMPTY: TunnelConfig = { version: 1, options: null, lastGood: null, best: null, updatedAt: 0 }

function parsePreset(input: unknown): SavedPreset | null {
  const o = (input ?? null) as Record<string, unknown> | null
  if (!o || typeof o !== "object" || !o.options) return null
  const latency = Number(o.latencyMs)
  return {
    options: parseOptions(o.options),
    latencyMs: Number.isFinite(latency) ? latency : null,
    at: Number(o.at) || 0,
  }
}

export function loadConfig(): TunnelConfig {
  try {
    const raw = JSON.parse(readFileSync(configFile(), "utf8")) as Record<string, unknown>
    return {
      version: 1,
      options: raw.options ? parseOptions(raw.options) : null,
      lastGood: parsePreset(raw.lastGood),
      best: parsePreset(raw.best),
      updatedAt: Number(raw.updatedAt) || 0,
    }
  } catch {
    return { ...EMPTY }
  }
}

export function saveConfig(patch: Partial<Omit<TunnelConfig, "version" | "updatedAt">>): TunnelConfig {
  const next: TunnelConfig = { ...loadConfig(), ...patch, version: 1, updatedAt: Date.now() }
  try {
    mkdirSync(dataDir(), { recursive: true })
    const tmp = `${configFile()}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
    renameSync(tmp, configFile())
  } catch {
    // Read-only or ephemeral filesystem: the config still applies for this process via the callers' memory.
  }
  return next
}

export const saveOptions = (options: StartOptions) => saveConfig({ options })

export function sameOptions(a: StartOptions | null | undefined, b: StartOptions | null | undefined) {
  if (!a || !b) return false
  return a.protocol === b.protocol && a.transport === b.transport && a.scan === b.scan && a.ip === b.ip &&
    a.noize === b.noize && a.port === b.port && a.httpProxy === b.httpProxy && a.quickReconnect === b.quickReconnect
}

// ---- persistence detection -------------------------------------------------------------------------------

const EPHEMERAL_FS = new Set(["overlay", "overlayfs", "tmpfs", "ramfs", "aufs", "rootfs", "squashfs", "devtmpfs"])

function unescapeMount(p: string) {
  return p.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)))
}

/** Longest mount point (from /proc/self/mountinfo text) that contains `dir`. */
export function findMount(mountinfo: string, dir: string): { mountPoint: string; fsType: string } | null {
  let best: { mountPoint: string; fsType: string } | null = null
  for (const line of mountinfo.split("\n")) {
    const parts = line.split(" ")
    const dash = parts.indexOf("-")
    if (parts.length < 7 || dash < 6) continue
    const mountPoint = unescapeMount(parts[4])
    const fsType = parts[dash + 1]
    const contains = mountPoint === "/" || dir === mountPoint || dir.startsWith(mountPoint.endsWith("/") ? mountPoint : `${mountPoint}/`)
    if (contains && (!best || mountPoint.length >= best.mountPoint.length)) best = { mountPoint, fsType }
  }
  return best
}

export interface PersistenceInput {
  dir?: string
  mountinfo?: string | null
  env?: Record<string, string | undefined>
}

export function detectPersistence(input: PersistenceInput = {}): PersistenceInfo {
  const dir = input.dir ?? dataDir()
  const env = input.env ?? process.env
  const base = { dir, mountPoint: null, fsType: null }

  if (["1", "true"].includes((env.PERSISTENCE_OK ?? "").toLowerCase())) {
    return { ...base, persistent: true, reason: "PERSISTENCE_OK=1" }
  }
  const volume = env.RAILWAY_VOLUME_MOUNT_PATH?.replace(/\/+$/, "")
  if (volume && (dir === volume || dir.startsWith(`${volume}/`))) {
    return { ...base, persistent: true, mountPoint: volume, reason: "Railway volume" }
  }

  let mountinfo = input.mountinfo
  if (mountinfo === undefined) {
    try {
      mountinfo = readFileSync("/proc/self/mountinfo", "utf8")
    } catch {
      mountinfo = null
    }
  }
  if (!mountinfo) return { ...base, persistent: null, reason: "mount table unavailable" }

  const mount = findMount(mountinfo, dir)
  if (!mount) return { ...base, persistent: null, reason: "mount not found" }
  if (mount.mountPoint === "/" || EPHEMERAL_FS.has(mount.fsType)) {
    return { ...base, persistent: false, ...mount, reason: `on ${mount.fsType} (${mount.mountPoint}), not a mounted volume` }
  }
  return { ...base, persistent: true, ...mount, reason: `mounted volume ${mount.mountPoint} (${mount.fsType})` }
}

