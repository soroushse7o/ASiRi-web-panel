"use client"

import { useState } from "react"
import useSWR from "swr"
import { DEFAULT_OPTIONS, type AetherStatus, type StartOptions } from "@/lib/types"
import { BestCard } from "./best-card"
import { ConnectionCard } from "./connection-card"
import { ExitCard } from "./exit-card"
import { HealthCard } from "./health-card"
import { InstallCard } from "./install-card"
import { LogsPanel } from "./logs-panel"
import { PersistenceBanner } from "./persistence-banner"
import { SettingsCard } from "./settings-card"
import { ShareCard } from "./share-card"
import { StatusPill } from "./status-pill"

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json() as Promise<AetherStatus>)

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? "درخواست ناموفق بود")
  return data as T
}

export function Dashboard({ initialStatus }: { initialStatus: AetherStatus }) {
  const { data, mutate } = useSWR("/api/aether/status", fetcher, {
    fallbackData: initialStatus,
    refreshInterval: 1500,
  })
  const status = data ?? initialStatus
  const [draft, setDraft] = useState<StartOptions>(initialStatus.options ?? initialStatus.savedOptions ?? DEFAULT_OPTIONS)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const options = status.running && status.options ? status.options : draft

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setActionError(null)
    try {
      await fn()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      await mutate()
      setBusy(false)
    }
  }

  const toggle = () =>
    act(() =>
      status.running ? postJson("/api/aether/stop") : postJson<AetherStatus>("/api/aether/start", draft),
    )

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between gap-3 py-2">
        <div className="flex items-center gap-3">
          <img src="/icon.png" alt="" width={36} height={36} className="size-9 rounded-xl" />
          <div className="flex flex-col">
            <h1 className="text-lg font-bold leading-tight">ASiRi</h1>
            <p className="text-xs text-muted">پنل کنترل aether (غیر رسمی)</p>
          </div>
        </div>
        <a
          href="https://github.com/soroushse7o"
          target="_blank"
          rel="noopener noreferrer"
          dir="ltr"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
        >
          <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 fill-current">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
          github
        </a>
        <StatusPill phase={status.phase} />
      </header>

      <PersistenceBanner persistence={status.persistence} />

      <main className="flex flex-col gap-4">
        {!status.binary ? (
          <InstallCard onInstall={() => act(() => postJson("/api/aether/install"))} busy={busy} />
        ) : (
          <ConnectionCard status={status} options={options} busy={busy} onToggle={toggle} />
        )}

        {actionError && (
          <p role="alert" className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {actionError}
          </p>
        )}

        {(status.running || status.share.phase !== "off") && (
          <ShareCard
            share={status.share}
            tunnelReady={status.phase === "connected"}
            busy={busy}
            onStart={() => act(() => postJson("/api/aether/share/start"))}
            onStop={() => act(() => postJson("/api/aether/share/stop"))}
            onSave={(settings) => act(() => postJson("/api/aether/share/settings", settings))}
          />
        )}

        {status.phase === "connected" && <ExitCard exit={status.exit} />}

        {status.binary && (
          <BestCard
            best={status.bestConfig}
            lastGood={status.lastGood}
            busy={busy}
            onStart={() => act(() => postJson("/api/aether/best"))}
            onCancel={() => act(() => postJson("/api/aether/best/cancel"))}
          />
        )}

        <SettingsCard value={options} onChange={setDraft} disabled={status.running || status.bestConfig.state === "running"} />

        <HealthCard status={status} />

        <LogsPanel logs={status.logs} />
      </main>
    </div>
  )
}
