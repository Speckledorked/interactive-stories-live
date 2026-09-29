// src/lib/ai/openaiThrottle.ts
//
// Two things #504 found missing around every provider call: a bound on how
// many run at once, and any handling at all for a 429.
//
// ── Why there was none ──────────────────────────────────────────────────
//
// Per-user velocity limits exist and are real, but they bound one person's
// rate, and a provider rate limit is shared by everyone. Ten users each
// comfortably inside their own limit are not inside the account's. The
// cron sweep makes this concrete: it can fan out across campaigns with no
// user in the loop at all.
//
// ── What a 429 did ──────────────────────────────────────────────────────
//
// Nothing caught it. Every call site fails open to a deterministic
// fallback — a template scene intro, freeform resolution, no
// classification — so a rate-limited deployment did not error. It quietly
// got worse at its job, which is the failure mode that takes longest to
// notice, because the prose still arrives.
//
// ── Scope, stated plainly ───────────────────────────────────────────────
//
// The concurrency gate below is PER INSTANCE. Module state in a serverless
// runtime is per warm instance, so this bounds the fan-out of any one
// invocation — which is where the burst actually comes from, since a
// single sweep or scene resolution issues its calls together — but it is
// not an account-wide cap. A true aggregate TPM ceiling needs shared
// state, and the shape of that (block, or shed load, and which callers
// may wait) is a product decision rather than a bug fix. Named here so
// nobody reads this file as more than it is.

/** Simultaneous provider calls allowed from one instance. */
const MAX_CONCURRENT_CALLS = 4

/** How many times to retry a rate-limited or transiently-failed call. */
const MAX_RATE_LIMIT_RETRIES = 3

/** First backoff step; doubles each attempt. */
const BASE_BACKOFF_MS = 1_000

/** Never wait longer than this for one attempt, whatever Retry-After says. */
const MAX_BACKOFF_MS = 20_000

let inFlight = 0
const waiting: Array<() => void> = []

async function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT_CALLS) {
    inFlight++
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
  inFlight++
}

function release(): void {
  inFlight--
  const next = waiting.shift()
  if (next) next()
}

/** Run `fn` with a slot held, releasing it however `fn` ends. */
export async function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}

/**
 * How long to wait before retrying, in milliseconds.
 *
 * Honours `Retry-After` when the provider sends one — it knows when the
 * window reopens and we do not, so guessing over the top of it is both
 * ruder and slower. Supports both of its forms (delay-seconds and an HTTP
 * date), because which one arrives is the provider's choice.
 *
 * Falls back to exponential backoff with jitter. The jitter is not
 * decoration: several calls from the same fan-out are rate-limited at the
 * same instant, and identical backoff would march them back into the
 * provider together and produce the same 429 again.
 */
export function backoffDelayMs(response: Response, attempt: number): number {
  const header = response.headers?.get?.('retry-after')
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS)
    }
    const date = Date.parse(header)
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(date - Date.now(), 0), MAX_BACKOFF_MS)
    }
  }

  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS)
  return Math.round(exponential * (0.5 + Math.random() * 0.5))
}

/**
 * Worth trying again?
 *
 * 429 ONLY, deliberately.
 *
 * A rate limit is a statement about timing — the same request will succeed
 * shortly — which is exactly the claim a retry needs. The provider's 5xx
 * responses are not that: they may be transient, they may be the request,
 * and this app's own fallback is genuinely good (a deterministic scene
 * intro, freeform resolution), so a caller that degrades immediately on a
 * 500 loses far less than every caller waiting out three backoffs first.
 *
 * Retrying 5xx here was written and then withdrawn: it made every existing
 * error-path test spend seven seconds sleeping to reach a result it
 * already had, which is a fair proxy for what it would do to a real
 * request. 400 is out for a different reason — that is a request this
 * deployment will keep getting wrong, and openaiCompat's own 400 handling
 * is what actually fixes those.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429
}

export const THROTTLE_LIMITS = {
  MAX_CONCURRENT_CALLS,
  MAX_RATE_LIMIT_RETRIES,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
} as const
