// src/app/api/ai-health/route.ts
// AI pipeline diagnostics: answers "why am I getting generic fallbacks?"
// from a browser. Makes one tiny real completion call per configured
// model — using the same parameter shape and compat wrapper as the app's
// actual calls — and returns exactly what OpenAI said. Anonymous but
// tightly rate-limited (it spends real, if tiny, API money) and it never
// echoes the API key, only the provider's error text.

import { NextResponse } from 'next/server'
import { AI_MODELS } from '@/lib/ai/models'
import { openaiFetch } from '@/lib/ai/openaiCompat'
import { checkRateLimit } from '@/lib/rateLimit'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

interface ModelCheck {
  tier: string
  model: string
  ok: boolean
  status?: number
  error?: string
  reply?: string
}

export async function GET() {
  const rateLimit = await checkRateLimit('anonymous', 'ai-health', 4, 60)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many health checks — try again in a minute.' }, { status: 429 })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      keyPresent: false,
      error: 'OPENAI_API_KEY is not set in this deployment environment.',
      checks: [],
    })
  }

  const checks: ModelCheck[] = []
  for (const [tier, model] of Object.entries(AI_MODELS)) {
    try {
      // Deliberately mirrors the app's call shape (max_tokens + custom
      // temperature) so this exercises the same compat path real calls do.
      const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
          temperature: 0.7,
          max_tokens: 10,
        }),
      })
      if (response.ok) {
        const data = await response.json()
        checks.push({ tier, model, ok: true, reply: data.choices?.[0]?.message?.content?.slice(0, 40) })
      } else {
        const body = await response.text()
        checks.push({ tier, model, ok: false, status: response.status, error: body.slice(0, 600) })
      }
    } catch (error) {
      checks.push({ tier, model, ok: false, error: String(error).slice(0, 300) })
    }
  }

  return NextResponse.json({
    ok: checks.every(c => c.ok),
    keyPresent: true,
    checks,
    note: 'Each check uses the same parameter shape as real gameplay calls, routed through the compatibility wrapper.',
  })
}
