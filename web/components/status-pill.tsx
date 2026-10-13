import { PHASE_LABEL, phaseTone } from "@/lib/labels"
import type { Phase } from "@/lib/types"

const TONE_CLASS = {
  on: "bg-accent/15 text-accent border-accent/30",
  busy: "bg-warn/15 text-warn border-warn/30",
  off: "bg-surface-2 text-muted border-border",
  bad: "bg-danger/15 text-danger border-danger/30",
}

const DOT_CLASS = {
  on: "bg-accent",
  busy: "bg-warn animate-pulse",
  off: "bg-muted",
  bad: "bg-danger",
}

export function StatusPill({ phase }: { phase: Phase }) {
  const tone = phaseTone(phase)
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${TONE_CLASS[tone]}`}
    >
      <span aria-hidden className={`size-2 rounded-full ${DOT_CLASS[tone]}`} />
      {PHASE_LABEL[phase]}
    </span>
  )
}
