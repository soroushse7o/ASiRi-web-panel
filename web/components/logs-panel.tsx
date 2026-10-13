"use client"

import { useEffect, useRef, useState } from "react"
import type { LogLine } from "@/lib/types"

const LEVEL_CLASS = { info: "text-foreground/80", warn: "text-warn", error: "text-danger" }

function shorten(text: string) {
  return text.replace(/^\[\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})\.\d+Z\s+(\w+)\s+[^\]]*\]\s*/, "$1 ")
}

export function LogsPanel({ logs }: { logs: LogLine[] }) {
  const [follow, setFollow] = useState(true)
  const boxRef = useRef<HTMLDivElement>(null)
  const lastId = logs.at(-1)?.id

  useEffect(() => {
    if (follow && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [lastId, follow])

  return (
    <section aria-labelledby="logs-title" className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 id="logs-title" className="text-sm font-semibold">
          لاگ‌ها
        </h2>
        <button
          type="button"
          onClick={() => setFollow((f) => !f)}
          aria-pressed={follow}
          className="min-h-11 rounded-lg px-3 text-xs text-muted aria-pressed:text-accent"
        >
          {follow ? "دنبال‌کردن: روشن" : "دنبال‌کردن: خاموش"}
        </button>
      </div>
      <div
        ref={boxRef}
        dir="ltr"
        tabIndex={0}
        aria-label="خروجی Aether"
        className="h-72 overflow-auto rounded-xl bg-background p-3 font-mono text-[11px] leading-5"
      >
        {logs.length === 0 ? (
          <p className="text-muted">No output yet.</p>
        ) : (
          logs.map((line) => (
            <p key={line.id} className={`whitespace-pre-wrap break-all ${LEVEL_CLASS[line.level]}`}>
              {shorten(line.text)}
            </p>
          ))
        )}
      </div>
    </section>
  )
}
