"use client"

import { Check, Copy, Dices, Globe, Loader2, Power, Save, Send } from "lucide-react"
import { useEffect, useState } from "react"
import type { RelayInfo, RelayPhase, ShareSettings, ShareStatus } from "@/lib/types"

const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

function randomString(len: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("")
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex items-center gap-2 rounded-xl bg-surface-2 py-1 ps-3 pe-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-muted">{label}</span>
        <span className="truncate font-mono text-sm" dir="ltr">
          {value}
        </span>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`کپی ${label}`}
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted active:bg-border/40"
      >
        {copied ? <Check className="size-4 text-accent" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
    </div>
  )
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs text-muted active:bg-border/40"
        >
          {copied ? <Check className="size-4 text-accent" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? "کپی شد" : "کپی همه"}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed" dir="ltr">
        {value}
      </pre>
    </div>
  )
}

function TelegramButton({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-background active:scale-[0.99]"
    >
      <Send className="size-4" aria-hidden />
      افزودن به تلگرام (یک‌لمسی)
    </a>
  )
}

const PHASE_TEXT: Record<RelayPhase, string> = {
  off: "خاموش",
  standby: "آماده‌باش (فقط هنگام قطعی)",
  starting: "در حال اتصال…",
  pending: "منتظر آدرس عمومی",
  on: "فعال",
  reconnecting: "اتصال مجدد…",
  error: "خطا",
}

function RelaySection({ relay }: { relay: RelayInfo }) {
  const on = relay.phase === "on" && relay.links.length > 0
  const tone =
    relay.phase === "on" ? "bg-accent/10 text-accent" : relay.phase === "error" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn"
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium" dir="auto">
          {relay.label}
        </h3>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${tone}`}>{PHASE_TEXT[relay.phase]}</span>
      </div>
      {on ? (
        <>
          {relay.host && relay.port && (
            <div className="grid grid-cols-2 gap-2">
              <CopyField label="سرور" value={relay.host} />
              <CopyField label="پورت" value={String(relay.port)} />
            </div>
          )}
          {relay.links.map((l) => (
            <div key={l.protocol} className="flex flex-col gap-2">
              <CopyField label={`${l.label}${l.encrypted ? "" : " — بدون رمزنگاری"}`} value={l.uri} />
              {l.extra && <TelegramButton href={l.extra} />}
            </div>
          ))}
          {relay.clientBlock && <CopyBlock label="بلوک آماده‌ی کلاینت" value={relay.clientBlock} />}
        </>
      ) : (
        (relay.error || relay.warning) && (
          <p role="status" className={`rounded-xl px-3 py-2 text-sm ${relay.phase === "error" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn"}`} dir="auto">
            {relay.error ?? relay.warning}
          </p>
        )
      )}
    </div>
  )
}

interface Draft {
  username: string
  password: string
  auto: boolean
}

const toDraft = (s: ShareSettings): Draft => ({
  username: s.username,
  password: s.password,
  auto: s.auto,
})

const toPayload = (d: Draft): ShareSettings => ({
  username: d.username.trim(),
  password: d.password.trim(),
  auto: d.auto,
})

const inputClass =
  "min-h-11 w-full rounded-xl border border-border bg-surface-2 px-3 font-mono text-sm outline-none focus-visible:border-accent disabled:opacity-50"

export function ShareCard({
  share,
  tunnelReady,
  busy,
  onStart,
  onStop,
  onSave,
}: {
  share: ShareStatus
  tunnelReady: boolean
  busy: boolean
  onStart: () => void
  onStop: () => void
  onSave: (settings: ShareSettings) => void
}) {
  const live = share.phase === "on"
  const starting = share.phase === "starting"
  const reconnecting = share.phase === "reconnecting"
  const active = starting || reconnecting || share.phase === "on"

  const serverKey = JSON.stringify(share.settings)
  const [draft, setDraft] = useState<Draft>(() => toDraft(share.settings))
  useEffect(() => {
    setDraft(toDraft(JSON.parse(serverKey) as ShareSettings))
  }, [serverKey])

  const dirty = JSON.stringify(toPayload(draft)) !== serverKey
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  return (
    <section aria-labelledby="share-title" className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="share-title" className="flex items-center gap-2 text-sm font-semibold">
            <Globe className="size-4 text-accent" aria-hidden />
            دسترسی از بیرون
          </h2>
          <p className="text-xs leading-relaxed text-muted">
            پراکسی را با نام کاربری و رمز روی یک آدرس عمومی منتشر می‌کند تا از گوشی یا کامپیوتر خودتان به آن وصل شوید.
          </p>
        </div>
        {live && (
          <span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-xs text-accent">
            {share.activeConnections} اتصال
          </span>
        )}
      </div>

      {live && share.username && share.password && (
        <div className="grid grid-cols-2 gap-2">
          <CopyField label="نام کاربری" value={share.username} />
          <CopyField label="رمز" value={share.password} />
        </div>
      )}

      {active && share.relays.filter((r) => r.enabled).map((r) => <RelaySection key={r.id} relay={r} />)}

      {live && (
        <p className="text-xs leading-relaxed text-muted">
          هر رله مستقل است. پروتکل‌های رمزنگاری‌شده (Shadowsocks، VLESS/Trojan روی WebSocket) در برابر فیلترینگ مقاوم‌ترند؛ SOCKS5 و HTTP
          CONNECT رمزنگاری ندارند.
        </p>
      )}

      {reconnecting && (
        <p role="status" className="rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">
          ارتباط همه‌ی رله‌ها قطع شد و دوباره تلاش می‌شود.
        </p>
      )}

      {share.phase === "error" && share.error && (
        <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger" dir="auto">
          {share.error}
        </p>
      )}

      <details className="group rounded-2xl border border-border">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between px-3 text-sm font-medium">
          تنظیمات اشتراک (ثابت‌کردن آدرس و رمز)
          {active && <span className="text-xs font-normal text-muted">برای تغییر، ابتدا متوقف کنید</span>}
        </summary>

        <div className="flex flex-col gap-3 border-t border-border p-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">نام کاربری</span>
            <div className="flex gap-2">
              <input
                dir="ltr"
                value={draft.username}
                disabled={active}
                onChange={(e) => set("username", e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={inputClass}
              />
              <button
                type="button"
                disabled={active}
                onClick={() => set("username", `ae${randomString(6).toLowerCase()}`)}
                aria-label="نام کاربری تصادفی"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted disabled:opacity-50"
              >
                <Dices className="size-4" aria-hidden />
              </button>
            </div>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">رمز</span>
            <div className="flex gap-2">
              <input
                dir="ltr"
                value={draft.password}
                disabled={active}
                onChange={(e) => set("password", e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={inputClass}
              />
              <button
                type="button"
                disabled={active}
                onClick={() => set("password", randomString(16))}
                aria-label="رمز تصادفی"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted disabled:opacity-50"
              >
                <Dices className="size-4" aria-hidden />
              </button>
            </div>
          </label>

          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
            <span className="flex flex-col">
              <span className="text-sm font-medium">شروع خودکار</span>
              <span className="text-xs text-muted">با هر بار وصل‌شدن تونل، اشتراک هم روشن شود</span>
            </span>
            <input
              type="checkbox"
              checked={draft.auto}
              disabled={active}
              onChange={(e) => set("auto", e.target.checked)}
              className="size-5 accent-[var(--color-accent)] disabled:opacity-50"
            />
          </label>

          <p className="text-xs leading-relaxed text-muted">
            نام کاربری و رمز فقط حروف انگلیسی، عدد و <span dir="ltr">. _ ~ -</span> می‌پذیرند. مقدارها ذخیره می‌شوند و با قطع و وصل
            شدن عوض نمی‌شوند.
          </p>

          <button
            type="button"
            disabled={active || busy || !dirty}
            onClick={() => onSave(toPayload(draft))}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-4 text-sm font-medium text-accent disabled:opacity-50"
          >
            <Save className="size-4" aria-hidden />
            ذخیره‌ی تنظیمات
          </button>
        </div>
      </details>

      <button
        type="button"
        onClick={active ? onStop : onStart}
        disabled={busy || starting || (!active && !tunnelReady)}
        className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium active:scale-[0.99] disabled:opacity-60 ${
          active ? "border border-danger/40 bg-danger/10 text-danger" : "bg-accent text-background"
        }`}
      >
        {busy || starting ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Power className="size-4" aria-hidden />
        )}
        {active
          ? starting
            ? "در حال ساخت آدرس عمومی..."
            : "توقف اشتراک"
          : tunnelReady
            ? "ساخت آدرس عمومی"
            : "منتظر اتصال تونل..."}
      </button>
    </section>
  )
}
