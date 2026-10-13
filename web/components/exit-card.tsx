"use client"

import { Activity, Loader2 } from "lucide-react"
import { useState } from "react"
import type { ExitInfo, TraceResult } from "@/lib/types"

function Stat({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-surface-2 px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate font-mono text-sm" dir="ltr">
        {value ?? "—"}
      </dd>
    </div>
  )
}

export function ExitCard({ exit }: { exit: ExitInfo | null }) {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TraceResult | null>(null)

  async function runTest() {
    setTesting(true)
    try {
      const res = await fetch("/api/aether/test", { method: "POST" })
      setResult((await res.json()) as TraceResult)
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <section aria-labelledby="exit-title" className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4">
      <h2 id="exit-title" className="text-sm font-semibold">
        خروجی تونل
      </h2>

      <dl className="grid grid-cols-2 gap-2">
        <Stat label="IP" value={exit?.ip} />
        <Stat label="کشور" value={exit ? `${exit.country} · ${exit.colo}` : null} />
        <Stat label="تأخیر تا Cloudflare" value={exit ? `${exit.latencyMs}ms` : null} />
        <Stat label="WARP" value={exit?.warp} />
      </dl>

      <button
        type="button"
        onClick={runTest}
        disabled={testing}
        className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-4 text-sm font-medium text-accent active:scale-[0.99] disabled:opacity-60"
      >
        {testing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Activity className="size-4" aria-hidden />}
        تست اتصال از طریق پراکسی
      </button>

      {result && (
        <div
          role="status"
          className={`rounded-xl px-3 py-2 font-mono text-xs leading-relaxed ${result.ok ? "bg-accent/10 text-accent" : "bg-danger/10 text-danger"}`}
          dir="ltr"
        >
          {result.ok
            ? `ip=${result.ip}  loc=${result.loc}  colo=${result.colo}  warp=${result.warp}  (${result.ms}ms)`
            : result.error}
        </div>
      )}
    </section>
  )
}
