// src/lib/ai/classification.ts
//
// Provider abstraction for action classification (resolution.ts).
//
// Why: classification used to call OpenAI directly, so an OpenAI outage
// (or a revoked key, or a 400 the openaiCompat wrapper cannot fix) meant
// every exchange in every campaign silently resolved freeform —
// classificationUnavailable with reason 'api-error', and no second
// chance. The classifier is the cheapest call in the scene pipeline and
// the one whose absence is most visible to players (no dice, no moves),
// so it gets a fallback: Anthropic, over plain HTTPS, no SDK.
//
// The abstraction is deliberately narrow — one prompt in, one JSON string
// out — because the two providers disagree on everything else (auth
// headers, request shape, response envelope, usage field names) and the
// caller should not know any of that. What the caller DOES need to know:
//   - which providers are configured (env-gated, checked per call so
//     tests can stub env without module reloads),
//   - the actual model that answered, so recordAICost bills the real one,
//   - and a sharp line between "the call failed" (throw → try the next
//     provider) and "the call worked but the JSON was unusable" (return
//     the content → the caller's validation decides, and 'unusable-output'
//     does NOT trigger a fallback retry).

/** What a provider hands back on a successful HTTP call. */
export interface ClassificationResult {
  /** Raw JSON string from the model — still unvalidated. */
  content: string
  usage: { promptTokens: number; completionTokens: number }
  /** The model that actually answered, for recordAICost. */
  model: string
}

export interface ClassificationProvider {
  /** 'openai' | 'anthropic' — appears in logs, never in player-facing text. */
  readonly name: string
  /**
   * False when the required env is missing. A skipped provider is
   * configuration, not failure: the caller reports 'no-api-key' only
   * when NO provider is configured.
   */
  isConfigured(): boolean
  /**
   * Run the classification prompt. Throws on transport/API failure
   * (network error, non-ok HTTP, malformed response envelope) — the
   * caller treats a throw as "try the next provider". A 200 whose
   * content is garbage is NOT a throw: that is 'unusable-output',
   * decided by the caller's own validation.
   */
  classify(prompt: string): Promise<ClassificationResult>
}

import { openaiFetch } from '@/lib/ai/openaiCompat'
import { AI_MODELS } from '@/lib/ai/models'

/** Shared by both providers — the classifier's entire job in one line. */
export const CLASSIFICATION_SYSTEM_PROMPT = 'You classify RPG actions to game moves. JSON only.'

/** Matches the token budget the OpenAI call has always used. */
const CLASSIFICATION_MAX_TOKENS = 500

export const openaiClassificationProvider: ClassificationProvider = {
  name: 'openai',

  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY
  },

  async classify(prompt: string): Promise<ClassificationResult> {
    const apiKey = process.env.OPENAI_API_KEY
    const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: AI_MODELS.EFFICIENT,
        messages: [
          { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        max_tokens: CLASSIFICATION_MAX_TOKENS,
        response_format: { type: 'json_object' },
      }),
    })
    if (!response.ok) {
      throw new Error(`OpenAI classification API error: ${response.status}`)
    }
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('OpenAI classification returned no message content')
    }
    return {
      content,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
      },
      model: AI_MODELS.EFFICIENT,
    }
  },
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
// The long-standing stable API version. Pin it: unpinned, Anthropic may
// change request/response behavior under us.
const ANTHROPIC_API_VERSION = '2023-06-01'

export const anthropicClassificationProvider: ClassificationProvider = {
  name: 'anthropic',

  isConfigured(): boolean {
    // Both or nothing: a key with no model (or a model with no key) is
    // not a configured provider, it is a half-finished setup, and
    // failing the whole classification over it would be wrong.
    return !!process.env.ANTHROPIC_API_KEY && !!process.env.ANTHROPIC_CLASSIFICATION_MODEL
  },

  async classify(prompt: string): Promise<ClassificationResult> {
    // Direct HTTPS, no SDK: the classification call is one endpoint with
    // a stable contract, and an SDK would be a dependency for a single
    // POST. Model comes from env — never hardcoded — so a model
    // retirement is a config change, not a code change.
    const apiKey = process.env.ANTHROPIC_API_KEY
    const model = process.env.ANTHROPIC_CLASSIFICATION_MODEL
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey ?? '',
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: CLASSIFICATION_MAX_TOKENS,
        temperature: 0,
        system: CLASSIFICATION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `Anthropic classification API error: ${response.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`
      )
    }
    const data = await response.json()
    const textBlock = data.content?.find((b: { type?: string }) => b.type === 'text')
    if (typeof textBlock?.text !== 'string' || textBlock.text.length === 0) {
      throw new Error('Anthropic classification returned no text content')
    }
    return {
      content: textBlock.text,
      usage: {
        promptTokens: data.usage?.input_tokens ?? 0,
        completionTokens: data.usage?.output_tokens ?? 0,
      },
      // Non-null: isConfigured() guarantees it, and classify() is only
      // called for configured providers.
      model: model as string,
    }
  },
}

/** Primary first, fallback after — the order scenes depend on. */
export const CLASSIFICATION_PROVIDERS: ClassificationProvider[] = [
  openaiClassificationProvider,
  anthropicClassificationProvider,
]
