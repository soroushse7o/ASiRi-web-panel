"use client"

import { Bell, Loader2, ShieldCheck } from "lucide-react"
import { useState } from "react"
import type { AetherStatus } from "@/lib/types"

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-mono text-sm" dir="ltr">
        {value}
      </dd>
    </div>
  )
}

export function HealthCard({ status }: { status: AetherStatus }) {
  const { watchdog, autoStart, notify } = status
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function sendTest() {
    setSending(true)
    setNote(null)
    try {
      const res = await fetch("/api/aether/notify/test", { method: "POST" })
      const data = (await res.json()) as { error?: string; sent?: string[]; errors?: string[] }
      setNote(res.ok ? `ارسال شد: ${(data.sent ?? []).join(", ")}` : (data.error ?? data.errors?.join("; ") ?? "ارسال ناموفق بود"))
    } catch (err) {
      setNote((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <section aria-labelledby="health-title" className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4">
      <h2 id="health-title" className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="size-4 text-accent" aria-hidden />
        پایش و اعلان
      </h2>
      <dl className="flex flex-col gap-2">
        <Row label="Watchdog" value={watchdog.enabled ? "on" : "off"} />
        <Row label="AUTO_START" value={autoStart ? "on" : "off"} />
        <Row label="Health failures" value={`${watchdog.consecutiveFailures}/${watchdog.maxFailures}`} />
        <Row label="Restarts" value={String(watchdog.restarts)} />
        {watchdog.nextRestartInSec !== null && <Row label="Restart in" value={`${watchdog.nextRestartInSec}s`} />}
        <Row label="Notify" value={notify.configured ? notify.channels.join(" + ") : "—"} />
      </dl>
      {watchdog.lastReason && (
        <p className="text-xs text-muted" dir="ltr">
          Last: {watchdog.lastReason}
        </p>
      )}
      {notify.configured && (
        <button
          type="button"
          onClick={sendTest}
          disabled={sending}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 px-4 text-sm disabled:opacity-60"
        >
          {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Bell className="size-4" aria-hidden />}
          ارسال اعلان آزمایشی
        </button>
      )}
      {note && (
        <p role="status" className="text-xs text-muted" dir="auto">
          {note}
        </p>
      )}
    </section>
  )
}
