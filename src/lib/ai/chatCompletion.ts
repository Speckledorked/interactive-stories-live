// src/lib/ai/chatCompletion.ts
// One raw OpenAI chat-completion call — the shape every simple two-message
// (system + user) prompt call in this codebase repeated independently:
// build the request body, call openaiFetch, and pull the assistant's
// message content back out. Used by every "generate a small artifact"
// caller (askGm.ts, worldGenerator.ts, worldExtras.ts, moveFlavor.ts, and
// three functions in worldState.ts) plus client.ts's callAIForWorldTurn.
//
// Deliberately NOT used by client.ts's callAIGM: that call has a repair
// round-trip, circuit-breaker bookkeeping, and outcome-adherence checks
// woven through it that make it a materially different shape, not just a
// bigger version of this one.
//
// Everything downstream of the raw content string — parsing JSON vs.
// treating it as plain text, validating/normalizing the response shape,
// each caller's own error-handling convention (throw vs. return null vs.
// fall back to a template), and cost tracking — stays with the caller.
// Those genuinely differ per call site; folding them in here would just
// move the duplication rather than remove it.

import { openaiFetch } from './openaiCompat'

export interface ChatCompletionRequest {
  apiKey: string
  model: string
  systemPrompt: string
  userPrompt: string
  temperature: number
  maxTokens: number
  /** Sets response_format: { type: 'json_object' } when true. Omit for a plain-text completion. */
  jsonMode?: boolean
}

export interface ChatCompletionSuccess {
  ok: true
  content: string
  usage: { prompt_tokens?: number; completion_tokens?: number }
}

export interface ChatCompletionFailure {
  ok: false
  status: number
}

export type ChatCompletionResult = ChatCompletionSuccess | ChatCompletionFailure

export async function callChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
  const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${request.apiKey}`,
    },
    body: JSON.stringify({
      model: request.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  })

  if (!response.ok) {
    return { ok: false, status: response.status }
  }

  const data = await response.json()
  // Not optional-chained on purpose: every existing call site (bar one,
  // which already treats any exception here as "return null" — the same
  // outcome a thrown TypeError produces) relies on a malformed response
  // throwing here rather than silently producing an empty string, so its
  // own try/catch's fallback path still runs.
  const content: string = data.choices[0].message.content
  const usage = data.usage || {}
  return { ok: true, content, usage }
}
