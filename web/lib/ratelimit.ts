// Small in-memory rate limiter + backoff helpers. No dependencies, safe to import anywhere.

export interface RateLimiterOptions {
  /** Events allowed per window before the key is blocked. */
  max: number
  windowMs: number
  /** How long a key stays blocked after exceeding `max` (default: windowMs). */
  blockMs?: number
  maxKeys?: number
  now?: () => number
}

export interface RateResult {
  allowed: boolean
  count: number
  remaining: number
  retryAfterMs: number
}

interface Entry {
  times: number[]
  blockedUntil: number
}

export class RateLimiter {
  readonly max: number
  readonly windowMs: number
  readonly blockMs: number
  private readonly maxKeys: number
  private readonly now: () => number
  private readonly entries = new Map<string, Entry>()

  constructor(opts: RateLimiterOptions) {
    this.max = opts.max
    this.windowMs = opts.windowMs
    this.blockMs = opts.blockMs ?? opts.windowMs
    this.maxKeys = opts.maxKeys ?? 5000
    this.now = opts.now ?? Date.now
  }

  private prune(entry: Entry, now: number) {
    const cutoff = now - this.windowMs
    while (entry.times.length && entry.times[0] <= cutoff) entry.times.shift()
  }

  private result(entry: Entry | undefined, now: number): RateResult {
    if (!entry) return { allowed: true, count: 0, remaining: this.max, retryAfterMs: 0 }
    const blocked = entry.blockedUntil > now
    return {
      allowed: !blocked,
      count: entry.times.length,
      remaining: Math.max(0, this.max - entry.times.length),
      retryAfterMs: blocked ? entry.blockedUntil - now : 0,
    }
  }

  /** Looks at a key without recording an event. */
  check(key: string): RateResult {
    const now = this.now()
    const entry = this.entries.get(key)
    if (entry) this.prune(entry, now)
    return this.result(entry, now)
  }

  /** Records one event. The (max+1)th event inside the window blocks the key for `blockMs`. */
  hit(key: string): RateResult {
    const now = this.now()
    let entry = this.entries.get(key)
    if (!entry) {
      if (this.entries.size >= this.maxKeys) this.evict(now)
      entry = { times: [], blockedUntil: 0 }
      this.entries.set(key, entry)
    }
    this.prune(entry, now)
    entry.times.push(now)
    if (entry.times.length > this.max) {
      entry.blockedUntil = now + this.blockMs
      return { allowed: false, count: entry.times.length, remaining: 0, retryAfterMs: this.blockMs }
    }
    return this.result(entry, now)
  }

  reset(key: string) {
    this.entries.delete(key)
  }

  get size() {
    return this.entries.size
  }

  private evict(now: number) {
    for (const [key, entry] of this.entries) {
      this.prune(entry, now)
      if (!entry.times.length && entry.blockedUntil <= now) this.entries.delete(key)
    }
    // Still full: drop the oldest keys (Map keeps insertion order).
    for (const key of this.entries.keys()) {
      if (this.entries.size < this.maxKeys) break
      this.entries.delete(key)
    }
  }
}

/** Exponential backoff, zero-indexed: attempt 0 → baseMs, 1 → 2×baseMs, … capped at maxMs. */
export function backoffMs(attempt: number, baseMs = 2_000, maxMs = 300_000): number {
  const n = Math.max(0, Math.floor(attempt))
  return Math.min(maxMs, baseMs * 2 ** Math.min(n, 30))
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const g = globalThis as unknown as { __aetherApiLimiter?: RateLimiter }

/** Shared limiter for the expensive panel endpoints (best-config, test notification…). */
export function getApiLimiter(): RateLimiter {
  return (g.__aetherApiLimiter ??= new RateLimiter({ max: 8, windowMs: 60_000, blockMs: 30_000 }))
}

export function rateLimitResponse(result: RateResult): Response {
  const retry = Math.max(1, Math.ceil(result.retryAfterMs / 1000))
  return Response.json(
    { error: `Too many requests. Try again in ${retry}s.` },
    { status: 429, headers: { "Retry-After": String(retry) } },
  )
}
