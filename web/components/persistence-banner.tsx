import { HardDrive } from "lucide-react"
import type { PersistenceInfo } from "@/lib/types"

/** Shown only when TMPDIR is positively known NOT to be on a mounted volume. */
export function PersistenceBanner({ persistence }: { persistence: PersistenceInfo }) {
  if (persistence.persistent !== false) return null
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-warn">
      <HardDrive className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="flex flex-col gap-1 text-sm leading-relaxed">
        <p className="font-medium" dir="ltr">
          Settings and WARP identity will be lost on restart.
        </p>
        <p className="text-xs">
          برای ماندگاری، یک Volume بسازید و <span dir="ltr">TMPDIR</span> را روی آن بگذارید (مثلاً{" "}
          <span dir="ltr">/data/tmp</span>).
        </p>
      </div>
    </div>
  )
}
