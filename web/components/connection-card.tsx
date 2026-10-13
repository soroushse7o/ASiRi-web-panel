"use client"

import { Check, Copy, Loader2, Power } from "lucide-react"
import { useState } from "react"
import { formatDuration, PHASE_LABEL, phaseTone } from "@/lib/labels"
import type { AetherStatus, StartOptions } from "@/lib/types"

const PROTOCOL_NAME: Record<StartOptions["protocol"], string> = {
  masque: "MASQUE",
  wg: "WireGuard",
  gool: "Gool",
  mim: "MASQUE-in-MASQUE",
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2 text-start active:scale-[0.99]"
    >
      <span className="text-xs text-muted">{label}</span>
      <span className="flex items-center gap-2 font-mono text-sm" dir="ltr">
        {value}
        {copied ? <Check className="size-4 text-accent" aria-hidden /> : <Copy className="size-4 text-muted" aria-hidden />}
        <span className="sr-only">{copied ? "کپی شد" : "کپی"}</span>
      </span>
    </button>
  )
}

export function ConnectionCard({
  status,
  options,
  busy,
  onToggle,
}: {
  status: AetherStatus
  options: StartOptions
  busy: boolean
  onToggle: () => void
}) {
  const tone = phaseTone(status.phase)
  const connected = tone === "on"
  const working = tone === "busy"

  const ring = connected
    ? "border-accent bg-accent text-accent-foreground shadow-[0_0_60px_-10px] shadow-accent"
    : working
      ? "border-warn/60 bg-surface-2 text-warn"
      : "border-border bg-surface-2 text-foreground"

  return (
    <section aria-labelledby="conn-title" className="flex flex-col items-center gap-5 rounded-3xl border border-border bg-surface p-5">
      <h2 id="conn-title" className="sr-only">
        اتصال
      </h2>

      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={status.running}
        aria-label={status.running ? "قطع اتصال" : "اتصال"}
        className={`relative mt-2 flex size-36 items-center justify-center rounded-full border-2 transition-all active:scale-95 disabled:opacity-60 ${ring}`}
      >
        {working && <span aria-hidden className="absolute inset-0 animate-ping rounded-full border-2 border-warn/40" />}
        {busy ? <Loader2 className="size-12 animate-spin" aria-hidden /> : <Power className="size-12" aria-hidden />}
      </button>

      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-xl font-bold">{status.running ? PHASE_LABEL[status.phase] : "برای اتصال لمس کنید"}</p>
        <p className="text-sm text-muted">
          <span dir="ltr">{PROTOCOL_NAME[options.protocol]}</span>
          {options.protocol !== "wg" && (
            <>
              {" · "}
              <span dir="ltr">{options.transport === "h2" ? "HTTP/2" : "HTTP/3"}</span>
            </>
          )}
          {" · "}
          <span dir="ltr">{options.scan}</span>
        </p>
      </div>

      {status.lastError && !connected && (
        <p className="w-full rounded-xl bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger" dir="ltr">
          {status.lastError}
        </p>
      )}

      <dl className="grid w-full grid-cols-2 gap-2">
        <div className="flex flex-col gap-1 rounded-xl bg-surface-2 px-3 py-2">
          <dt className="text-xs text-muted">مدت اتصال</dt>
          <dd className="font-mono text-base" dir="ltr">
            {formatDuration(status.uptimeSec)}
          </dd>
        </div>
        <div className="flex flex-col gap-1 rounded-xl bg-surface-2 px-3 py-2">
          <dt className="text-xs text-muted">Gateway</dt>
          <dd className="truncate font-mono text-sm" dir="ltr">
            {status.gateway ?? "—"}
          </dd>
        </div>
      </dl>

      <div className="flex w-full flex-col gap-2">
        <CopyRow label="SOCKS5" value={`127.0.0.1:${options.port}`} />
        {options.httpProxy && <CopyRow label="HTTP" value={`127.0.0.1:${options.port + 1}`} />}
      </div>
    </section>
  )
}
