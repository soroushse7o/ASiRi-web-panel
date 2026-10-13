// Relay configuration + link builders. Every relay is an independent provider: its own config, lifecycle and
// status. Nothing here couples one relay to another.
//
// Relays kept:
//   railway - TCP relay: Railway TCP Proxy, or your own VPS (RELAY_PUBLIC_HOST / RELAY_PUBLIC_PORT)
//   ws      - VLESS/Trojan over WebSocket on the panel's HTTP domain (port 443)

type Env = Record<string, string | undefined>

export const RELAY_KINDS = ["railway", "ws"] as const
export type RelayKind = (typeof RELAY_KINDS)[number]

export const RELAY_LABELS: Record<RelayKind, string> = {
  railway: "TCP Relay (Railway / VPS)",
  ws: "Panel domain (WebSocket, 443)",
}

export const PROTOCOLS = ["socks", "http", "ss"] as const
export type GatewayProtocol = (typeof PROTOCOLS)[number]
export const SS_CIPHERS = ["chacha20-ietf-poly1305", "aes-256-gcm", "aes-128-gcm"] as const
export type SsCipher = (typeof SS_CIPHERS)[number]

const falsy = (v: string | undefined) => ["0", "false", "off", "no"].includes((v ?? "").trim().toLowerCase())

export function parsePort(value: string | undefined): number | null {
  if (!value || !value.trim()) return null
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null
}

function cleanHost(value: string | undefined): string | null {
  return (value ?? "").trim().replace(/\.$/, "") || null
}

export interface RailwayConfig {
  enabled: boolean
  bindHost: string
  /** Fixed container port the gateway listens on. Must match the "port" configured in Railway's TCP Proxy. */
  bindPort: number | null
  /** Public host:port that clients use (Railway's TCP proxy domain + external port). */
  publicHost: string | null
  publicPort: number | null
  warnings: string[]
}

export interface InboundConfig {
  /** VLESS/Trojan over WebSocket behind the panel's HTTP domain (edge TLS, port 443). */
  enabled: boolean
  vless: boolean
  trojan: boolean
  /** null = derived from the share credentials (stable, unguessable). */
  path: string | null
  /** Public HTTP(S) domain of the panel (Railway injects RAILWAY_PUBLIC_DOMAIN). */
  publicHost: string | null
  publicPort: number
  tls: boolean
  warnings: string[]
}

export interface GatewayConfig {
  protocols: GatewayProtocol[]
  ssCipher: SsCipher
  /** Optional fixed local gateway port. */
  localPort: number | null
}

export interface RelayConfig extends RailwayConfig {
  gateway: GatewayConfig
  inbound: InboundConfig
}

export function loadRailwayConfig(env: Env = process.env): RailwayConfig {
  const warnings: string[] = []
  let bindPort = parsePort(env.RELAY_PORT)
  if (env.RELAY_PORT && bindPort === null) warnings.push("RELAY_PORT is not a valid port (1-65535); relay disabled")
  if (bindPort === null && env.RELAY_PORT === undefined) bindPort = parsePort(env.RAILWAY_TCP_APPLICATION_PORT)

  const panelPort = parsePort(env.PORT) ?? 3000
  if (bindPort !== null && (bindPort === panelPort || bindPort === panelPort + 1)) {
    warnings.push(`RELAY_PORT ${bindPort} collides with the panel port (${panelPort}); relay disabled`)
    bindPort = null
  }

  const publicHost = cleanHost(env.RELAY_PUBLIC_HOST || env.RAILWAY_TCP_PROXY_DOMAIN)
  const publicPort = parsePort(env.RELAY_PUBLIC_PORT) ?? parsePort(env.RAILWAY_TCP_PROXY_PORT)
  if (bindPort !== null && (!publicHost || !publicPort)) {
    warnings.push("TCP Proxy host:port unknown. Enable TCP Proxy in Railway or set RELAY_PUBLIC_HOST / RELAY_PUBLIC_PORT")
  }
  return { enabled: bindPort !== null, bindHost: (env.RELAY_BIND_HOST || "0.0.0.0").trim(), bindPort, publicHost, publicPort, warnings }
}

export function loadInboundConfig(env: Env = process.env): InboundConfig {
  const warnings: string[] = []
  const kinds = (env.INBOUND_WS ?? "vless,trojan")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const off = kinds.length === 0 || kinds.includes("off") || kinds.includes("0") || falsy(env.INBOUND_WS)
  const vless = !off && kinds.includes("vless")
  const trojan = !off && kinds.includes("trojan")
  let path: string | null = null
  if (env.INBOUND_WS_PATH?.trim()) {
    const p = env.INBOUND_WS_PATH.trim()
    if (/^\/[A-Za-z0-9._~\-/]{1,120}$/.test(p) && !p.startsWith("/api/") && !p.startsWith("/_next")) path = p.replace(/\/+$/, "") || "/"
    else warnings.push("INBOUND_WS_PATH must look like /some-path (letters, digits, . _ ~ - /); using the derived path")
  }
  const publicHost = cleanHost(env.INBOUND_PUBLIC_HOST || env.RAILWAY_PUBLIC_DOMAIN || env.RENDER_EXTERNAL_HOSTNAME)
  if ((vless || trojan) && !publicHost) warnings.push("Panel HTTP domain unknown. Generate a Railway domain or set INBOUND_PUBLIC_HOST")
  const tls = !falsy(env.INBOUND_TLS)
  const publicPort = parsePort(env.INBOUND_PUBLIC_PORT) ?? (tls ? 443 : 80)
  return { enabled: vless || trojan, vless, trojan, path, publicHost, publicPort, tls, warnings }
}

export function loadGatewayConfig(env: Env = process.env): GatewayConfig {
  const list = (env.SHARE_PROTOCOLS ?? "socks,http,ss")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is GatewayProtocol => (PROTOCOLS as readonly string[]).includes(s))
  const protocols = list.length ? Array.from(new Set(list)) : ["socks" as GatewayProtocol]
  const cipher = (env.SS_CIPHER ?? "").trim().toLowerCase()
  const ssCipher = (SS_CIPHERS as readonly string[]).includes(cipher) ? (cipher as SsCipher) : "chacha20-ietf-poly1305"
  return { protocols, ssCipher, localPort: parsePort(env.GATEWAY_PORT) }
}

export function loadRelayConfig(env: Env = process.env): RelayConfig {
  return {
    ...loadRailwayConfig(env),
    gateway: loadGatewayConfig(env),
    inbound: loadInboundConfig(env),
  }
}

// ---------------------------------------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------------------------------------

export type LinkProtocol = "socks5" | "http" | "shadowsocks" | "vless-ws" | "trojan-ws"

export interface RelayLink {
  protocol: LinkProtocol
  label: string
  /** Importable URI. */
  uri: string
  /** Extra one-tap link (Telegram) when the protocol supports it. */
  extra: string | null
  /** false = the hop to the client is not encrypted by the protocol itself. */
  encrypted: boolean
}

export interface LinkInput {
  host: string
  port: number
  username: string
  password: string
  name?: string
  protocols?: GatewayProtocol[]
  ssCipher?: SsCipher
}

export interface Links {
  /** socks://BASE64(user:pass)@host:port#name (v2ray-style import link) */
  uri: string
  /** socks5://user:pass@host:port */
  uriClassic: string
  /** https://t.me/socks?server=…&port=…&user=…&pass=… */
  telegramLink: string
  /** Copy-ready block with every field and link. */
  clientBlock: string
  /** Every enabled protocol (socks5 / http / shadowsocks) for this endpoint. */
  links: RelayLink[]
}

export function shadowsocksUri(host: string, port: number, password: string, cipher: SsCipher, name: string) {
  const userinfo = Buffer.from(`${cipher}:${password}`).toString("base64url")
  return `ss://${userinfo}@${host}:${port}#${encodeURIComponent(name)}`
}

export function buildLinks({ host, port, username, password, name = "ASiRi", protocols = ["socks"], ssCipher = "chacha20-ietf-poly1305" }: LinkInput): Links {
  const credentials = Buffer.from(`${username}:${password}`).toString("base64")
  const uri = `socks://${encodeURIComponent(credentials)}@${host}:${port}#${name}`
  const uriClassic = `socks5://${username}:${password}@${host}:${port}`
  const q = new URLSearchParams({ server: host, port: String(port), user: username, pass: password })
  const telegramLink = `https://t.me/socks?${q.toString()}`

  const links: RelayLink[] = []
  const block: string[] = []
  if (protocols.includes("socks")) {
    links.push({ protocol: "socks5", label: "SOCKS5", uri, extra: telegramLink, encrypted: false })
    block.push("Type: SOCKS5", `Server: ${host}`, `Port: ${port}`, `Username: ${username}`, `Password: ${password}`, "", `Import: ${uri}`, `Classic: ${uriClassic}`, `Telegram: ${telegramLink}`)
  }
  if (protocols.includes("ss")) {
    const ss = shadowsocksUri(host, port, password, ssCipher, `${name}-SS`)
    links.push({ protocol: "shadowsocks", label: `Shadowsocks (${ssCipher})`, uri: ss, extra: null, encrypted: true })
    if (block.length) block.push("")
    block.push(`Shadowsocks: ${ss}`, `  cipher=${ssCipher} password=${password}`)
  }
  if (protocols.includes("http")) {
    const http = `http://${username}:${password}@${host}:${port}`
    links.push({ protocol: "http", label: "HTTP CONNECT (unencrypted)", uri: http, extra: null, encrypted: false })
    if (block.length) block.push("")
    block.push(`HTTP proxy (CONNECT, unencrypted): ${http}`)
  }
  return { uri, uriClassic, telegramLink, clientBlock: block.join("\n"), links }
}
