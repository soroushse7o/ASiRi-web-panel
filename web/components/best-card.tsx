"use client"

import { Loader2, Sparkles, Square } from "lucide-react"
import type { BestConfigStatus, SavedPreset } from "@/lib/types"

const presetLabel = (p: SavedPreset) =>
  p.options.protocol === "wg"
    ? `wg · ${p.options.scan}`
    : `${p.options.protocol} · ${p.options.transport} · ${p.options.scan}`

export function BestCard({
  best,
  lastGood,
  busy,
  onStart,
  onCancel,
}: {
  best: BestConfigStatus
  lastGood: SavedPreset | null
  busy: boolean
  onStart: () => void
  onCancel: () => void
}) {
  const running = best.state === "running"
  const pct = best.total ? Math.round((best.done / best.total) * 100) : 0

  return (
    <section aria-labelledby="best-title" className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h2 id="best-title" className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-accent" aria-hidden />
          بهترین کانفیگ
        </h2>
        <p className="text-xs leading-relaxed text-muted">
          ترکیب پروتکل، ترنسپورت و حالت اسکن را یکی‌یکی امتحان می‌کند، تأخیر را می‌سنجد و برنده را ذخیره می‌کند. در این مدت تونل
          چند دقیقه قطع و وصل می‌شود.
        </p>
      </div>

      {running && (
        <div className="flex flex-col gap-2" role="status">
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted" dir="ltr">
            {best.done}/{best.total} · {best.current ?? "…"}
          </p>
        </div>
      )}

      {best.results.length > 0 && (
        <ul className="flex max-h-56 flex-col gap-1 overflow-auto text-xs" dir="ltr">
          {best.results.map((r) => (
            <li key={r.label} className="flex justify-between gap-3 rounded-lg bg-surface-2 px-3 py-1.5 font-mono">
              <span className={best.winner?.label === r.label ? "text-accent" : ""}>{r.label}</span>
              <span className={r.ok ? "" : "text-danger"}>{r.ok ? `${r.latencyMs} ms` : (r.error ?? "failed")}</span>
            </li>
          ))}
        </ul>
      )}

      {best.message && !running && (
        <p className={`rounded-xl px-3 py-2 text-sm ${best.state === "failed" ? "bg-danger/10 text-danger" : "bg-accent/10 text-accent"}`} dir="ltr">
          {best.message}
        </p>
      )}

      {lastGood && (
        <p className="text-xs text-muted" dir="ltr">
          Last known-good: {presetLabel(lastGood)}
          {lastGood.latencyMs ? ` · ${lastGood.latencyMs} ms` : ""}
        </p>
      )}

      <button
        type="button"
        onClick={running ? onCancel : onStart}
        disabled={busy && !running}
        className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium active:scale-[0.99] disabled:opacity-60 ${
          running ? "border border-danger/40 bg-danger/10 text-danger" : "bg-accent text-background"
        }`}
      >
        {running ? <Square className="size-4" aria-hidden /> : busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
        {running ? "لغو جستجو" : "پیدا کردن بهترین کانفیگ"}
      </button>
    </section>
  )
}
