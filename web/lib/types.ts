export const PROTOCOLS = ["masque", "wg", "gool", "mim"] as const
export const TRANSPORTS = ["h2", "h3"] as const
export const SCAN_MODES = ["turbo", "balanced", "thorough", "verified", "ironclad"] as const
export const IP_MODES = ["4", "6", "dual"] as const
export const NOIZE_PROFILES = ["default", "off", "light", "firewall", "balanced", "gfw", "aggressive"] as const

export type Protocol = (typeof PROTOCOLS)[number]
export type Transport = (typeof TRANSPORTS)[number]
export type ScanMode = (typeof SCAN_MODES)[number]
export type IpMode = (typeof IP_MODES)[number]
export type NoizeProfile = (typeof NOIZE_PROFILES)[number]

export interface StartOptions {
  protocol: Protocol
  transport: Transport
  scan: ScanMode
  ip: IpMode
  noize: NoizeProfile
  port: number
  httpProxy: boolean
  quickReconnect: boolean
}

export const DEFAULT_OPTIONS: StartOptions = {
  protocol: "masque",
  transport: "h2",
  scan: "turbo",
  ip: "4",
  noize: "default",
  port: 1819,
  httpProxy: false,
  quickReconnect: true,
}

export type Phase = "stopped" | "starting" | "scanning" | "connecting" | "connected" | "reconnecting" | "error"

export interface LogLine {
  id: number
  text: string
  level: "info" | "warn" | "error"
  ts: number
}

export interface ExitInfo {
  ip: string
  country: string
  colo: string
  latencyMs: number
  warp: string | null
}

export interface AetherStatus {
  binary: string | null
  running: boolean
  phase: Phase
  pid: number | null
  options: StartOptions | null
  gateway: string | null
  exit: ExitInfo | null
  lastError: string | null
  uptimeSec: number | null
  runningSec: number | null
  logs: LogLine[]
  share: ShareStatus
  /** Options persisted from the last start (or the best-config winner); null if nothing was saved yet. */
  savedOptions: StartOptions | null
  /** AUTO_START=1: the tunnel is started automatically after every restart of the panel. */
  autoStart: boolean
  persistence: PersistenceInfo
  watchdog: WatchdogStatus
  bestConfig: BestConfigStatus
  lastGood: SavedPreset | null
  notify: { configured: boolean; channels: string[] }
}

export interface PersistenceInfo {
  /** true = TMPDIR is on a mounted volume, false = ephemeral container filesystem, null = could not be determined. */
  persistent: boolean | null
  dir: string
  mountPoint: string | null
  fsType: string | null
  reason: string
}

export interface WatchdogStatus {
  enabled: boolean
  consecutiveFailures: number
  maxFailures: number
  restarts: number
  nextRestartInSec: number | null
  lastCheckAt: number | null
  lastCheckOk: boolean | null
  lastReason: string | null
}

export interface SavedPreset {
  options: StartOptions
  latencyMs: number | null
  at: number
}

export interface BestResult {
  label: string
  protocol: Protocol
  transport: Transport
  scan: ScanMode
  ok: boolean
  latencyMs: number | null
  connectMs: number | null
  error: string | null
}

export interface BestConfigStatus {
  state: "idle" | "running" | "done" | "failed" | "cancelled"
  total: number
  done: number
  current: string | null
  results: BestResult[]
  winner: BestResult | null
  startedAt: number | null
  finishedAt: number | null
  message: string | null
}

export type RelayPhase = "off" | "standby" | "starting" | "pending" | "on" | "reconnecting" | "error"

export interface RelayLinkInfo {
  protocol: "socks5" | "http" | "shadowsocks" | "vless-ws" | "trojan-ws"
  label: string
  /** Importable URI for this protocol. */
  uri: string
  /** One-tap extra link (Telegram) when available. */
  extra: string | null
  /** false = the hop to the client is plain text (SOCKS5 password / HTTP CONNECT). */
  encrypted: boolean
}

/** One independent relay (TCP relay on Railway / VPS, or the panel WebSocket inbound). */
export interface RelayInfo {
  id: string
  label: string
  enabled: boolean
  phase: RelayPhase
  host: string | null
  port: number | null
  links: RelayLinkInfo[]
  /** Copy-ready block with every field and link of this relay. */
  clientBlock: string | null
  /** Configuration problem (missing variable ...). */
  warning: string | null
  error: string | null
}

export interface ShareSettings {
  username: string
  password: string
  /** Start sharing automatically the first time the tunnel connects after it is started. */
  auto: boolean
}

export interface ShareStatus {
  /** Overall state: on as soon as any relay is up. */
  phase: "off" | "starting" | "on" | "reconnecting" | "error"
  username: string | null
  password: string | null
  /** Every configured relay with its own phase and links. */
  relays: RelayInfo[]
  /** Protocols the TCP gateway accepts on every relay port (socks / http / ss). */
  protocols: string[]
  ssCipher: string
  activeConnections: number
  totalConnections: number
  error: string | null
  settings: ShareSettings
}

const SHARE_NAME_RE = /^[A-Za-z0-9._~-]{3,32}$/
const SHARE_PASS_RE = /^[A-Za-z0-9._~-]{8,64}$/

export type ParsedShareSettings = { ok: true; value: ShareSettings } | { ok: false; error: string }

export function parseShareSettings(input: unknown): ParsedShareSettings {
  const o = (input ?? {}) as Record<string, unknown>
  const username = typeof o.username === "string" ? o.username.trim() : ""
  const password = typeof o.password === "string" ? o.password.trim() : ""
  if (!SHARE_NAME_RE.test(username)) {
    return { ok: false, error: "نام کاربری باید ۳ تا ۳۲ کاراکتر باشد و فقط حروف انگلیسی، عدد و . _ ~ - داشته باشد." }
  }
  if (!SHARE_PASS_RE.test(password)) {
    return { ok: false, error: "رمز باید ۸ تا ۶۴ کاراکتر باشد و فقط حروف انگلیسی، عدد و . _ ~ - داشته باشد." }
  }
  return { ok: true, value: { username, password, auto: o.auto === true } }
}

export interface TraceResult {
  ok: boolean
  ip?: string
  loc?: string
  colo?: string
  warp?: string
  ms?: number
  error?: string
}

function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return list.includes(value as T) ? (value as T) : fallback
}

export function parseOptions(input: unknown): StartOptions {
  const o = (input ?? {}) as Record<string, unknown>
  const port = Number(o.port)
  return {
    protocol: oneOf(PROTOCOLS, o.protocol, DEFAULT_OPTIONS.protocol),
    transport: oneOf(TRANSPORTS, o.transport, DEFAULT_OPTIONS.transport),
    scan: oneOf(SCAN_MODES, o.scan, DEFAULT_OPTIONS.scan),
    ip: oneOf(IP_MODES, o.ip, DEFAULT_OPTIONS.ip),
    noize: oneOf(NOIZE_PROFILES, o.noize, DEFAULT_OPTIONS.noize),
    port: Number.isInteger(port) && port >= 1024 && port <= 65534 ? port : DEFAULT_OPTIONS.port,
    httpProxy: o.httpProxy === true,
    quickReconnect: o.quickReconnect !== false,
  }
}
