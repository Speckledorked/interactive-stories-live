// src/lib/ai/openaiCompat.ts
// Drop-in fetch wrapper for OpenAI chat-completions calls that survives
// parameter-compatibility breaks between model generations.
//
// Why: the GPT-5-family endpoints reject legacy parameters with a 400 —
// `max_tokens` must be `max_completion_tokens`, and several models only
// accept the default `temperature`. Every call site in this codebase
// predates that. When the model roster was bumped (see models.ts), those
// 400s were swallowed by each site's fail-open error handling, so the
// app silently degraded to its deterministic fallbacks (template scene
// intros, freeform resolution, no classification) — the "generic
// openings" bug.
//
// This wrapper keeps each call site's own error handling intact: same
// signature as fetch, and only intervenes on a 400 that names a
// parameter it knows how to fix, retrying exactly once.
//
// #504 also made this the place for the concurrency bound and the 429
// retry, because it is already the single funnel every provider call goes
// through — sixteen call sites across nine files, none of which should
// have to know about rate limits to be correct. See openaiThrottle.ts for
// what those do and, just as importantly, what they do not.

import { withConcurrencyLimit, backoffDelayMs, isRetryableStatus, THROTTLE_LIMITS } from './openaiThrottle'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * fetch, plus: a slot from the per-instance concurrency gate, and retries
 * on the provider's transient statuses.
 *
 * The slot is held across the retries on purpose. Releasing it while
 * sleeping would let a waiting call start straight into the same rate
 * limit that just rejected this one, which turns backoff into a queue that
 * takes turns being refused.
 *
 * Returns the final response whatever it is, so every existing call site's
 * own `if (!response.ok)` handling still reaches exactly the outcome it
 * did before — this only changes how many attempts precede it.
 */
async function fetchWithBackoff(url: string, init: RequestInit): Promise<Response> {
  return withConcurrencyLimit(async () => {
    let response = await fetch(url, init)

    for (let attempt = 0; attempt < THROTTLE_LIMITS.MAX_RATE_LIMIT_RETRIES; attempt++) {
      if (!isRetryableStatus(response.status)) return response

      const delay = backoffDelayMs(response, attempt)
      console.warn(
        `OpenAI ${response.status}; retrying in ${delay}ms (attempt ${attempt + 1}/${THROTTLE_LIMITS.MAX_RATE_LIMIT_RETRIES})`
      )
      await sleep(delay)
      response = await fetch(url, init)
    }

    // Out of retries. Handing the last response back rather than throwing
    // keeps the caller's fail-open path intact — but a 429 reaching here
    // means the deployment is degrading to deterministic fallbacks, which
    // reads as "the writing got worse" rather than as an error, so it is
    // worth saying loudly.
    if (isRetryableStatus(response.status)) {
      console.error(`OpenAI ${response.status} after ${THROTTLE_LIMITS.MAX_RATE_LIMIT_RETRIES} retries — falling back`)
    }
    return response
  })
}

export async function openaiFetch(url: string, init: RequestInit): Promise<Response> {
  const response = await fetchWithBackoff(url, init)
  if (response.status !== 400 || typeof init.body !== 'string') {
    return response
  }

  // 400: read the error to see if it's a fixable parameter complaint.
  const errorText = await response.text()
  const passthrough = () =>
    new Response(errorText, { status: response.status, statusText: response.statusText, headers: response.headers })

  let payload: any
  try {
    payload = JSON.parse(init.body)
  } catch {
    return passthrough()
  }

  const swapMaxTokens = errorText.includes('max_tokens') && payload.max_tokens !== undefined
  const dropTemperature = errorText.includes('temperature') && payload.temperature !== undefined
  // Same defensive shape as the two checks above: prompt caching
  // (prompt_cache_key/prompt_cache_retention, see client.ts's cacheParams)
  // is documented as valid for every model this app calls today, but isn't
  // something this sandbox can verify against a live account — if some
  // account/model combination rejects it, drop it and retry once rather
  // than failing the whole scene resolution over a cost optimization.
  const dropCacheParams = (errorText.includes('prompt_cache_key') || errorText.includes('prompt_cache_retention'))
    && (payload.prompt_cache_key !== undefined || payload.prompt_cache_retention !== undefined)
  if (!swapMaxTokens && !dropTemperature && !dropCacheParams) {
    return passthrough()
  }

  if (swapMaxTokens) {
    payload.max_completion_tokens = payload.max_tokens
    delete payload.max_tokens
  }
  if (dropTemperature) {
    delete payload.temperature
  }
  if (dropCacheParams) {
    delete payload.prompt_cache_key
    delete payload.prompt_cache_retention
  }

  console.warn(
    `OpenAI compat retry: ${[swapMaxTokens && 'max_tokens→max_completion_tokens', dropTemperature && 'temperature→default', dropCacheParams && 'dropped prompt cache params']
      .filter(Boolean)
      .join(', ')}`
  )
  return fetchWithBackoff(url, { ...init, body: JSON.stringify(payload) })
}
