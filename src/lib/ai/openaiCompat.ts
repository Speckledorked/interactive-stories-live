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

export async function openaiFetch(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init)
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
  return fetch(url, { ...init, body: JSON.stringify(payload) })
}
