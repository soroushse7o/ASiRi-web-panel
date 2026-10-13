import type { Phase } from "./types"

export const PHASE_LABEL: Record<Phase, string> = {
  stopped: "خاموش",
  starting: "در حال راه‌اندازی",
  scanning: "در حال جستجوی gateway",
  connecting: "در حال اتصال",
  connected: "متصل",
  reconnecting: "اتصال مجدد",
  error: "خطا",
}

export function phaseTone(phase: Phase): "on" | "busy" | "off" | "bad" {
  if (phase === "connected") return "on"
  if (phase === "error") return "bad"
  if (phase === "stopped") return "off"
  return "busy"
}

export function formatDuration(sec: number | null) {
  if (sec == null) return "—"
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
