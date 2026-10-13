// AUTO_START boot, persisted config, watchdog restart (with notification) and best-config sweep,
// using a fake `aether` binary and a fake `curl` so no network is needed.
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, test } from "node:test"
import { startWebhook, waitFor } from "./helpers.ts"

const tmp = mkdtempSync(path.join(os.tmpdir(), "aether-wd-"))
const binDir = path.join(tmp, "bin")
mkdirSync(binDir)
const argsFile = path.join(tmp, "last-args")

const fakeAether = path.join(binDir, "aether")
writeFileSync(
  fakeAether,
  `#!/bin/sh
echo "$@" > "${argsFile}"
echo "[INFO] scan mode=turbo"
echo "[INFO] using cloudflare edge 162.159.0.1"
echo "[INFO] socks5 server listening on 127.0.0.1:1819"
exec sleep 100000
`,
)
// Fake curl: succeeds, but "gool" is slow and h3 is a bit slower, so masque/h2 must win the sweep.
writeFileSync(
  path.join(binDir, "curl"),
  `#!/bin/sh
a="$(cat "${argsFile}" 2>/dev/null)"
case "$a" in *"--protocol gool"*) sleep 0.4;; *--h3*) sleep 0.2;; *) sleep 0.02;; esac
exit 0
`,
)
chmodSync(fakeAether, 0o755)
chmodSync(path.join(binDir, "curl"), 0o755)

const webhook = await startWebhook()
Object.assign(process.env, {
  TMPDIR: tmp,
  PATH: `${binDir}:${process.env.PATH}`,
  AETHER_BIN: fakeAether,
  AUTO_START: "1",
  WATCHDOG_TICK_SEC: "0.2",
  WATCHDOG_BACKOFF_BASE_SEC: "0.2",
  WATCHDOG_INTERVAL_SEC: "3600",
  WATCHDOG_MAX_FAILURES: "99",
  NOTIFY_WEBHOOK_URL: webhook.url,
  NOTIFY_COOLDOWN_SEC: "0",
})

const aether = await import("../web/lib/aether.ts")
const { bootOnce } = await import("../web/lib/boot.ts")
const { loadConfig, saveOptions } = await import("../web/lib/config-store.ts")
const { getWatchdogStatus } = await import("../web/lib/watchdog.ts")
const best = await import("../web/lib/bestconfig.ts")
const { DEFAULT_OPTIONS } = await import("../web/lib/types.ts")

after(async () => {
  await aether.stopAether()
  await webhook.close()
})

test("AUTO_START boots the tunnel from the persisted config", async () => {
  saveOptions({ ...DEFAULT_OPTIONS, protocol: "gool", scan: "balanced" })
  assert.deepEqual(bootOnce(), { booted: true, started: true })
  assert.deepEqual(bootOnce(), { booted: false, started: false }) // idempotent
  await waitFor(() => aether.getRuntime().phase === "connected", 5000, "connected")
  assert.match(readFileSync(argsFile, "utf8"), /--protocol gool --scan balanced/)
})

test("watchdog restarts a killed Aether process with backoff and notifies tunnel_down", async () => {
  const pid = aether.getStatus().pid!
  process.kill(pid, "SIGKILL")
  await waitFor(() => aether.getStatus().pid && aether.getStatus().pid !== pid, 8000, "new process")
  await waitFor(() => aether.getRuntime().phase === "connected", 5000, "reconnected")
  assert.ok(getWatchdogStatus().restarts >= 1)
  const down = await waitFor(() => webhook.received.find((h) => h.event === "tunnel_down"), 3000, "tunnel_down hook")
  assert.match(down.text, /Aether process exited/)
})

test("best-config picks the lowest-latency combo, saves it and restarts the tunnel with it", async () => {
  best.startBest({ protocols: ["masque", "gool"], scans: ["turbo"] })
  assert.throws(() => best.startBest({}), /در حال اجراست/)
  await waitFor(() => best.getBestStatus().state !== "running", 60_000, "sweep finished")

  const status = best.getBestStatus()
  assert.equal(status.state, "done")
  assert.equal(status.total, 4)
  assert.equal(status.results.length, 4)
  assert.equal(status.winner?.label, "masque · h2 · turbo")

  const saved = loadConfig()
  assert.equal(saved.best?.options.protocol, "masque")
  assert.equal(saved.best?.options.transport, "h2")
  assert.equal(saved.lastGood?.options.protocol, "masque")
  assert.equal(saved.options?.protocol, "masque")

  await waitFor(() => aether.getRuntime().phase === "connected", 5000, "tunnel restarted")
  assert.equal(aether.getRuntime().options?.protocol, "masque")
})
