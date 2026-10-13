"use client"

import { useId } from "react"
import {
  IP_MODES,
  NOIZE_PROFILES,
  PROTOCOLS,
  SCAN_MODES,
  TRANSPORTS,
  type StartOptions,
} from "@/lib/types"

const LABELS: Record<string, string> = {
  masque: "MASQUE",
  wg: "WireGuard",
  gool: "Gool",
  mim: "MiM",
  h2: "HTTP/2",
  h3: "HTTP/3",
  "4": "IPv4",
  "6": "IPv6",
  dual: "هر دو",
  default: "پیش‌فرض",
}

function Segmented<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string
  hint?: string
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span id={id} className="text-sm font-medium">
          {label}
        </span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = opt === value
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(opt)}
              className={`min-h-11 rounded-xl border px-3.5 text-sm transition-colors disabled:opacity-50 ${
                active
                  ? "border-accent/50 bg-accent/15 text-accent"
                  : "border-border bg-surface-2 text-foreground"
              }`}
            >
              <span dir="ltr">{LABELS[opt] ?? opt}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 has-disabled:opacity-50">
      <span className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted">{hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="relative h-7 w-12 shrink-0 rounded-full bg-surface-2 ring-1 ring-border transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent after:absolute after:top-1 after:start-1 after:size-5 after:rounded-full after:bg-foreground after:transition-all peer-checked:after:start-6 peer-checked:after:bg-accent-foreground"
      />
    </label>
  )
}

export function SettingsCard({
  value,
  onChange,
  disabled,
}: {
  value: StartOptions
  onChange: (v: StartOptions) => void
  disabled: boolean
}) {
  const set = <K extends keyof StartOptions>(key: K, v: StartOptions[K]) => onChange({ ...value, [key]: v })

  return (
    <section aria-labelledby="settings-title" className="flex flex-col gap-5 rounded-3xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 id="settings-title" className="text-sm font-semibold">
          تنظیمات
        </h2>
        {disabled && <span className="text-xs text-muted">برای تغییر، ابتدا قطع کنید</span>}
      </div>

      <Segmented label="پروتکل" options={PROTOCOLS} value={value.protocol} onChange={(v) => set("protocol", v)} disabled={disabled} />

      {value.protocol !== "wg" && (
        <Segmented
          label="ترنسپورت"
          hint="روی بیشتر هاست‌ها HTTP/2 مطمئن‌تر است"
          options={TRANSPORTS}
          value={value.transport}
          onChange={(v) => set("transport", v)}
          disabled={disabled}
        />
      )}

      <Segmented label="حالت اسکن" options={SCAN_MODES} value={value.scan} onChange={(v) => set("scan", v)} disabled={disabled} />
      <Segmented label="نسخه IP" options={IP_MODES} value={value.ip} onChange={(v) => set("ip", v)} disabled={disabled} />
      <Segmented label="مبهم‌سازی (noize)" options={NOIZE_PROFILES} value={value.noize} onChange={(v) => set("noize", v)} disabled={disabled} />

      <div className="flex flex-col gap-2">
        <label htmlFor="port" className="text-sm font-medium">
          پورت SOCKS5
        </label>
        <input
          id="port"
          type="number"
          inputMode="numeric"
          min={1024}
          max={65534}
          dir="ltr"
          disabled={disabled}
          value={value.port}
          onChange={(e) => set("port", Number(e.target.value))}
          className="min-h-11 rounded-xl border border-border bg-surface-2 px-3 font-mono text-base outline-none focus-visible:border-accent disabled:opacity-50"
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <Toggle
          label="پراکسی HTTP"
          hint={`روی پورت ${value.port + 1}`}
          checked={value.httpProxy}
          onChange={(v) => set("httpProxy", v)}
          disabled={disabled}
        />
        <Toggle
          label="اتصال سریع"
          hint="استفاده از آخرین gateway سالم"
          checked={value.quickReconnect}
          onChange={(v) => set("quickReconnect", v)}
          disabled={disabled}
        />
      </div>
    </section>
  )
}
