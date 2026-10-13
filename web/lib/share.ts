import "server-only"
import { randomBytes } from "node:crypto"
import type { IncomingMessage } from "node:http"
import net from "node:net"
import type { Duplex } from "node:stream"
import { handleClient, type GatewayContext } from "./gateway"
import { buildInboundLinks, deriveInbound, handleUpgrade, type InboundRuntime } from "./inbound"
import { notify } from "./notifier"
import type { WsProbeTarget } from "./wsprobe"
import { backoffMs, RateLimiter, sleep } from "./ratelimit"
import {
  buildLinks,
  loadInboundConfig,
  loadRelayConfig,
  RELAY_LABELS,
  type RelayConfig,
  type RelayKind,
} from "./relay"
import { parseShareSettings, type RelayInfo, type RelayLinkInfo, type RelayPhase, type ShareSettings, type ShareStatus } from "./types"

// Share credentials live in process.env only (SHARE_USERNAME / SHARE_PASSWORD / SHARE_AUTO): nothing about the
// authentication is written to disk (no os.tmpdir() files). Settings saved from the UI update process.env for the
// life of the process; set the variables in the platform's environment UI to make them permanent.

/**
 * Every relay is independent. The only thing they share is the local gateway (the authenticated multi-protocol
 * proxy in front of the Aether SOCKS5), which is created once per share session.
 *
 *   railway  - the gateway bound to RELAY_PORT behind Railway's TCP Proxy, or exposed on your own VPS
 *   ws       - VLESS/Trojan over WebSocket on the panel's own HTTP port (edge TLS, 443)
 */
interface ShareState {
  /** The user (or auto-start) wants sharing on; the relays keep themselves alive while true. */
  wanted: boolean
  stopRequested: boolean
  settings: ShareSettings
  cfg: RelayConfig | null
  server: net.Server | null
  sockets: Set<net.Socket>
  gatewayPort: number | null
  upstreamPort: number | null
  totalConnections: number
  /** The local gateway could not start: nothing can work. */
  fatal: string | null
  railwayServer: net.Server | null
  railwayError: string | null
  /** Last announced signature of every relay's links (memory only). */
  announced: Record<string, string>
}

type UpgradeHook = (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean

function randomCredentials() {
  return {
    username: `ae${randomBytes(3).toString("hex")}`,
    password: randomBytes(12).toString("base64url"),
  }
}

// Priority: process.env (SHARE_*) > random. Random credentials are written back to process.env so they stay
// stable while the process lives (they change on restart unless SHARE_USERNAME / SHARE_PASSWORD are set).
function loadSettings(): ShareSettings {
  const random = randomCredentials()
  const explicit = Boolean(process.env.SHARE_USERNAME && process.env.SHARE_PASSWORD)
  const fromEnv = parseShareSettings({
    username: process.env.SHARE_USERNAME || random.username,
    password: process.env.SHARE_PASSWORD || random.password,
    auto: ["1", "true"].includes((process.env.SHARE_AUTO ?? "").toLowerCase()),
  })
  const value: ShareSettings = fromEnv.ok ? fromEnv.value : { ...random, auto: false }
  if (!explicit || !fromEnv.ok) console.warn("[share] SHARE_USERNAME / SHARE_PASSWORD not set (or invalid): random credentials are used until restart.")
  applySettingsToEnv(value)
  return value
}

function applySettingsToEnv(value: ShareSettings) {
  process.env.SHARE_USERNAME = value.username
  process.env.SHARE_PASSWORD = value.password
  process.env.SHARE_AUTO = value.auto ? "1" : "0"
}

const globalForShare = globalThis as unknown as { __aetherShare2?: ShareState; __aetherWsUpgrade?: UpgradeHook }

const state: ShareState = (globalForShare.__aetherShare2 ??= {
  wanted: false,
  stopRequested: false,
  settings: loadSettings(),
  cfg: null,
  server: null,
  sockets: new Set<net.Socket>(),
  gatewayPort: null,
  upstreamPort: null,
  totalConnections: 0,
  fatal: null,
  railwayServer: null,
  railwayError: null,
  announced: {},
})

// Failed-login tracking per listener+remote address. Behind a tunnel / Railway the remote address is a proxy, so
// instead of blocking (which would lock out legitimate users) failures are slowed down and reported.
const authFails = ((globalThis as unknown as { __aetherAuthFails?: RateLimiter }).__aetherAuthFails ??= new RateLimiter({
  max: 10,
  windowMs: 60_000,
}))

async function onAuthFailure(listener: string, remote: string | undefined) {
  const result = authFails.hit(`${listener}:${remote ?? "?"}`)
  if (!result.allowed && result.count === authFails.max + 1) {
    void notify("relay_error", `⚠️ Repeated failed logins on the ${listener} relay (${remote ?? "unknown"}).`, {
      key: `auth:${listener}`,
    })
  }
  await sleep(backoffMs(result.count - 1, 250, 5_000))
}

function trackSocket(sock: net.Socket) {
  state.sockets.add(sock)
  state.totalConnections += 1
  sock.once("close", () => state.sockets.delete(sock))
}

function gatewayContext(): GatewayContext {
  const cfg = state.cfg ?? loadRelayConfig()
  return {
    username: state.settings.username,
    password: state.settings.password,
    upstreamPort: state.upstreamPort,
    protocols: cfg.gateway.protocols,
    ssCipher: cfg.gateway.ssCipher,
    onAuthFailure,
  }
}

function accept(client: net.Socket, listener: string) {
  trackSocket(client)
  client.on("error", () => client.destroy())
  handleClient(client, listener, gatewayContext()).catch(() => client.destroy())
}

// ---- WebSocket inbound (VLESS / Trojan) --------------------------------------------------------------------
// server.mjs calls this hook for every HTTP upgrade request; it claims only the inbound's own path.

function inboundRuntime(): InboundRuntime | null {
  const cfg = loadInboundConfig()
  if (!cfg.enabled) return null
  return {
    active: state.wanted && !state.stopRequested && state.upstreamPort != null,
    vless: cfg.vless,
    trojan: cfg.trojan,
    ident: deriveInbound(state.settings.username, state.settings.password, cfg.path),
    upstreamPort: state.upstreamPort,
    track: trackSocket,
    onAuthFailure: (remote) => onAuthFailure("ws", remote),
  }
}

globalForShare.__aetherWsUpgrade = (req, socket, head) => handleUpgrade(req, socket, head, inboundRuntime())

// ---- Local gateway + Railway TCP listener ------------------------------------------------------------------

function startGateway(port: number | null): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((client) => accept(client, "gateway"))
    server.once("error", reject)
    server.listen(port ?? 0, "127.0.0.1", () => {
      server.off("error", reject)
      server.on("error", () => {})
      state.server = server
      resolve((server.address() as net.AddressInfo).port)
    })
  })
}

function startRailwayListener(cfg: RelayConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((client) => accept(client, "railway"))
    server.once("error", reject)
    server.listen(cfg.bindPort!, cfg.bindHost, () => {
      server.off("error", reject)
      server.on("error", (err) => {
        state.railwayError = err.message
        void notify("relay_error", `⚠️ Railway relay error: ${err.message}`, { key: "relay-runtime" })
      })
      state.railwayServer = server
      resolve()
    })
  })
}

function closeGateway() {
  return new Promise<void>((resolve) => {
    const servers = [state.server, state.railwayServer].filter((x): x is net.Server => x !== null)
    state.server = null
    state.railwayServer = null
    state.gatewayPort = null
    for (const sock of state.sockets) sock.destroy()
    state.sockets.clear()
    if (!servers.length) return resolve()
    let left = servers.length
    for (const server of servers) {
      server.close(() => {
        left -= 1
        if (left === 0) resolve()
      })
    }
  })
}

export async function startShare(upstreamPort: number) {
  if (state.wanted) {
    state.upstreamPort = upstreamPort
    return
  }
  const cfg = loadRelayConfig()
  const wsUsable = cfg.inbound.enabled && Boolean(cfg.inbound.publicHost)
  if (!cfg.enabled && !wsUsable) {
    const message = "No relay is enabled: set RELAY_PORT (Railway TCP Proxy / VPS) or enable the panel WebSocket domain (see .env.example)."
    state.fatal = message
    throw new Error(message)
  }

  state.wanted = true
  state.stopRequested = false
  state.fatal = null
  state.upstreamPort = upstreamPort
  state.totalConnections = 0
  state.cfg = cfg

  try {
    state.gatewayPort = await startGateway(cfg.gateway.localPort)
  } catch (err) {
    state.wanted = false
    state.fatal = `Gateway could not start: ${(err as Error).message}`
    void notify("relay_error", `⚠️ ${state.fatal}`, { key: "share-start" })
    throw new Error(state.fatal)
  }
  if (!state.wanted) {
    await closeGateway()
    return
  }

  // Railway TCP Proxy listener: independent of every tunnel.
  state.railwayError = null
  if (cfg.enabled) {
    try {
      await startRailwayListener(cfg)
    } catch (err) {
      state.railwayError = (err as Error).message
      void notify("relay_error", `⚠️ Railway relay could not listen on ${cfg.bindHost}:${cfg.bindPort}: ${state.railwayError}`, { key: "relay-bind" })
    }
  }

  announceUris()
}

export async function stopShare() {
  state.wanted = false
  state.stopRequested = true
  await closeGateway()
  state.fatal = null
  state.railwayError = null
}

/** Saves the settings; only allowed while sharing is off so a live link never changes under the user. */
export function saveShareSettings(next: ShareSettings) {
  if (state.wanted) throw new Error("برای تغییر تنظیمات، ابتدا اشتراک را متوقف کنید.")
  state.settings = next
  applySettingsToEnv(next)
}

/** Called once per tunnel run when it first connects. Starts sharing if the "auto" option is on. */
export function autoStartShare(upstreamPort: number) {
  if (!state.settings.auto || state.wanted) return
  startShare(upstreamPort).catch(() => {
    // the error is exposed through getShareStatus()
  })
}

// ---- Status -------------------------------------------------------------------------------------------------

function toLinkInfo(links: ReturnType<typeof buildLinks>["links"]): RelayLinkInfo[] {
  return links.map((l) => ({ protocol: l.protocol, label: l.label, uri: l.uri, extra: l.extra, encrypted: l.encrypted }))
}

function baseInfo(kind: RelayKind, enabled: boolean, phase: RelayPhase): RelayInfo {
  return { id: kind, label: RELAY_LABELS[kind], enabled, phase, host: null, port: null, links: [], clientBlock: null, warning: null, error: null }
}

function railwayInfo(cfg: RelayConfig): RelayInfo {
  const info = baseInfo("railway", cfg.enabled, "off")
  if (!cfg.enabled) return { ...info, warning: cfg.warnings[0] ?? null }
  if (state.railwayError) return { ...info, phase: "error", error: state.railwayError }
  if (!state.railwayServer) return info
  if (!cfg.publicHost || !cfg.publicPort) return { ...info, phase: "pending", warning: cfg.warnings[0] ?? null }
  const { username, password } = state.settings
  const l = buildLinks({
    host: cfg.publicHost,
    port: cfg.publicPort,
    username,
    password,
    name: "ASiRi-Railway",
    protocols: cfg.gateway.protocols,
    ssCipher: cfg.gateway.ssCipher,
  })
  return { ...info, phase: "on", host: cfg.publicHost, port: cfg.publicPort, links: toLinkInfo(l.links), clientBlock: l.clientBlock }
}

function wsInfo(cfg: RelayConfig): RelayInfo {
  const inbound = cfg.inbound
  const info = baseInfo("ws", inbound.enabled, "off")
  if (!inbound.enabled) return info
  if (!state.wanted) return { ...info, warning: inbound.warnings[0] ?? null }
  if (!inbound.publicHost) return { ...info, phase: "pending", warning: inbound.warnings[0] ?? null }
  const { username, password } = state.settings
  const ident = deriveInbound(username, password, inbound.path)
  const links = buildInboundLinks(inbound, ident, password)
  return {
    ...info,
    phase: "on",
    host: inbound.publicHost,
    port: inbound.publicPort,
    links: links.map((l) => ({ protocol: l.protocol, label: l.label, uri: l.uri, extra: null, encrypted: true })),
    clientBlock: links.map((l) => `${l.label}: ${l.uri}`).join("\n"),
  }
}

function buildRelays(): RelayInfo[] {
  const cfg = state.cfg ?? loadRelayConfig()
  return [railwayInfo(cfg), wsInfo(cfg)]
}

/** Notifies (webhook / Telegram) when a relay's links are new or different from the last announced ones. */
function announceUris() {
  for (const relay of buildRelays()) {
    if (relay.phase !== "on" || !relay.links.length) continue
    const sig = relay.links.map((l) => l.uri).join("\n")
    const previous = state.announced[relay.id]
    if (previous === sig) continue
    state.announced[relay.id] = sig
    const head = previous ? `🔄 Subscription URL changed (${relay.label})` : `🔗 Subscription URL (${relay.label})`
    const first = relay.links[0]
    void notify("subscription_changed", `${head}\n${relay.links.map((l) => `${l.label}: ${l.uri}`).join("\n")}${first.extra ? `\nTelegram: ${first.extra}` : ""}`, {
      key: sig,
      data: { relay: relay.id, uri: first.uri, uris: relay.links.map((l) => l.uri), telegramLink: first.extra, changed: Boolean(previous) },
    })
  }
}

function overallPhase(relays: RelayInfo[]): ShareStatus["phase"] {
  if (state.fatal && !state.wanted) return "error"
  if (!state.wanted) return "off"
  const active = relays.filter((r) => r.enabled && r.phase !== "off" && r.phase !== "standby")
  if (active.some((r) => r.phase === "on" || r.phase === "pending")) return "on"
  if (active.some((r) => r.phase === "starting")) return "starting"
  if (active.some((r) => r.phase === "reconnecting")) return "reconnecting"
  if (active.length) return "error"
  return "starting"
}

export function getShareStatus(): ShareStatus {
  const cfg = state.cfg ?? loadRelayConfig()
  const relays = buildRelays()
  const phase = overallPhase(relays)
  const errors = relays.filter((r) => r.phase === "error" && r.error).map((r) => `${r.label}: ${r.error}`)
  return {
    phase,
    username: state.wanted ? state.settings.username : null,
    password: state.wanted ? state.settings.password : null,
    relays,
    protocols: cfg.gateway.protocols,
    ssCipher: cfg.gateway.ssCipher,
    activeConnections: state.sockets.size,
    totalConnections: state.totalConnections,
    error: state.fatal ?? (phase === "error" ? errors.join(" | ") || null : null),
    settings: state.settings,
  }
}

/**
 * Public WebSocket endpoint for the watchdog's external probe, or null when sharing / the WS inbound is not live
 * (the watchdog then falls back to the local SOCKS probe).
 */
export function getExternalProbeTarget(): WsProbeTarget | null {
  const cfg = state.cfg ?? loadRelayConfig()
  const inbound = cfg.inbound
  if (!state.wanted || state.stopRequested || !state.upstreamPort || !inbound.enabled || !inbound.publicHost) return null
  if (!inbound.vless && !inbound.trojan) return null
  return {
    host: inbound.publicHost,
    port: inbound.publicPort,
    tls: inbound.tls,
    path: deriveInbound(state.settings.username, state.settings.password, inbound.path).path,
    protocol: inbound.vless ? "vless" : "trojan",
    ident: deriveInbound(state.settings.username, state.settings.password, inbound.path),
  }
}
