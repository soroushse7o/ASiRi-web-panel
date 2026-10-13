import "server-only"
import { getStatus } from "./aether"
import { getBestStatus } from "./bestconfig"
import { detectPersistence, loadConfig } from "./config-store"
import { getNotifyInfo } from "./notifier"
import { getWatchdogStatus } from "./watchdog"
import type { AetherStatus } from "./types"

/** getStatus() plus the persisted config, persistence check, watchdog and best-config state. */
export function getFullStatus(): AetherStatus {
  const config = loadConfig()
  return {
    ...getStatus(),
    savedOptions: config.options,
    autoStart: ["1", "true"].includes((process.env.AUTO_START ?? "").toLowerCase()),
    persistence: detectPersistence(),
    watchdog: getWatchdogStatus(),
    bestConfig: getBestStatus(),
    lastGood: config.lastGood,
    notify: getNotifyInfo(),
  }
}
