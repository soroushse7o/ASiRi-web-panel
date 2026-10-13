// Webhook and/or Telegram bot notifications. Never throws; failures are returned, not raised.

export type NotifyEvent = "tunnel_down" | "subscription_changed" | "relay_error" | "test"
const ALL_EVENTS: NotifyEvent[] = ["tunnel_down", "subscription_changed", "relay_error"]

export interface NotifierConfig {
  webhookUrl: string | null
  telegramToken: string | null
  telegramChatId: string | null
  telegramApi: string
  events: Set<NotifyEvent>
  cooldownMs: number
  timeoutMs: number
}

export interface NotifyOptions {
  /** Same event + same key is sent at most once per cooldown. */
  key?: string
  data?: Record<string, unknown>
}

export interface NotifyResult {
  sent: string[]
  errors: string[]
  skipped: "no-channel" | "event-disabled" | "cooldown" | null
}

type Env = Record<string, string | undefined>

export function loadNotifierConfig(env: Env = process.env): NotifierConfig {
  const raw = (env.NOTIFY_WEBHOOK_URL ?? "").trim()
  let webhookUrl: string | null = null
  if (raw) {
    try {
      const u = new URL(raw)
      if (u.protocol === "http:" || u.protocol === "https:") webhookUrl = u.toString()
    } catch {
      // invalid URL: webhook channel stays disabled
    }
  }
  const token = (env.NOTIFY_TELEGRAM_BOT_TOKEN ?? "").trim()
  const chat = (env.NOTIFY_TELEGRAM_CHAT_ID ?? "").trim()
  const listed = (env.NOTIFY_EVENTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is NotifyEvent => (ALL_EVENTS as string[]).includes(s))
  const cooldown = Number(env.NOTIFY_COOLDOWN_SEC)
  return {
    webhookUrl,
    telegramToken: token && chat ? token : null,
    telegramChatId: token && chat ? chat : null,
    telegramApi: (env.NOTIFY_TELEGRAM_API ?? "https://api.telegram.org").replace(/\/+$/, ""),
    events: new Set(listed.length ? listed : ALL_EVENTS),
    cooldownMs: Number.isFinite(cooldown) && cooldown >= 0 ? cooldown * 1000 : 300_000,
    timeoutMs: 8_000,
  }
}

export function notifyChannels(cfg: NotifierConfig): string[] {
  const out: string[] = []
  if (cfg.webhookUrl) out.push("webhook")
  if (cfg.telegramToken) out.push("telegram")
  return out
}

function redact(message: string, cfg: NotifierConfig) {
  let out = message
  if (cfg.telegramToken) out = out.split(cfg.telegramToken).join("<token>")
  if (cfg.webhookUrl) out = out.split(cfg.webhookUrl).join("<webhook>")
  return out
}

export interface NotifierDeps {
  fetch?: typeof fetch
  now?: () => number
}

export function createNotifier(getConfig: () => NotifierConfig, deps: NotifierDeps = {}) {
  const doFetch = deps.fetch ?? fetch
  const now = deps.now ?? Date.now
  const lastSent = new Map<string, number>()

  async function post(url: string, body: unknown, cfg: NotifierConfig) {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }

  async function notify(event: NotifyEvent, text: string, opts: NotifyOptions = {}): Promise<NotifyResult> {
    const cfg = getConfig()
    const result: NotifyResult = { sent: [], errors: [], skipped: null }
    if (!notifyChannels(cfg).length) return { ...result, skipped: "no-channel" }
    if (event !== "test" && !cfg.events.has(event)) return { ...result, skipped: "event-disabled" }

    if (event !== "test") {
      const id = `${event}:${opts.key ?? ""}`
      const prev = lastSent.get(id)
      if (prev !== undefined && now() - prev < cfg.cooldownMs) return { ...result, skipped: "cooldown" }
      lastSent.set(id, now())
      if (lastSent.size > 500) lastSent.delete(lastSent.keys().next().value as string)
    }

    const ts = now()
    const jobs: Promise<void>[] = []
    if (cfg.webhookUrl) {
      const url = cfg.webhookUrl
      // `text` (Slack / generic) and `content` (Discord) are both filled so most webhook receivers work as-is.
      jobs.push(
        post(url, { source: "aether-panel", event, text, content: text, ts, data: opts.data ?? {} }, cfg).then(
          () => void result.sent.push("webhook"),
          (e: Error) => void result.errors.push(`webhook: ${redact(e.message, cfg)}`),
        ),
      )
    }
    if (cfg.telegramToken && cfg.telegramChatId) {
      const url = `${cfg.telegramApi}/bot${cfg.telegramToken}/sendMessage`
      jobs.push(
        post(url, { chat_id: cfg.telegramChatId, text, disable_web_page_preview: true }, cfg).then(
          () => void result.sent.push("telegram"),
          (e: Error) => void result.errors.push(`telegram: ${redact(e.message, cfg)}`),
        ),
      )
    }
    await Promise.all(jobs)
    return result
  }

  return { notify }
}

const g = globalThis as unknown as { __aetherNotifier?: ReturnType<typeof createNotifier> }

/** Process-wide notifier. Reads the NOTIFY_* environment on every call. */
export function notify(event: NotifyEvent, text: string, opts?: NotifyOptions): Promise<NotifyResult> {
  g.__aetherNotifier ??= createNotifier(() => loadNotifierConfig())
  return g.__aetherNotifier.notify(event, text, opts).catch((e: Error) => ({
    sent: [],
    errors: [e.message],
    skipped: null,
  }))
}

export function getNotifyInfo() {
  const channels = notifyChannels(loadNotifierConfig())
  return { configured: channels.length > 0, channels }
}
