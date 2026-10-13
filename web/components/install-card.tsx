import { Download, Loader2 } from "lucide-react"

export function InstallCard({ onInstall, busy }: { onInstall: () => void; busy: boolean }) {
  return (
    <section aria-labelledby="install-title" className="flex flex-col gap-4 rounded-3xl border border-border bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 id="install-title" className="text-base font-semibold">
          فایل اجرایی Aether نصب نیست
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          آخرین نسخه از صفحه‌ی Releases دانلود می‌شود، checksum آن بررسی می‌شود و روی سرور قرار می‌گیرد.
        </p>
      </div>
      <button
        type="button"
        onClick={onInstall}
        disabled={busy}
        className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-4 font-semibold text-accent-foreground active:scale-[0.99] disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Download className="size-5" aria-hidden />}
        {busy ? "در حال نصب..." : "نصب Aether"}
      </button>
    </section>
  )
}
