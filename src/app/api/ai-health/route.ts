// src/app/api/ai-health/route.ts
// Pipeline diagnostics: answers "why am I getting generic fallbacks?"
// Makes one tiny real completion call per configured model — using the
// same parameter shape and compat wrapper as the app's actual calls — and
// returns exactly what the provider said. It never echoes the API key,
// only the provider's error text.
//
// Platform-admin only (#509). This used to be anonymous, with a rate limit
// standing in for a gate, and the two are not the same thing: the limit was
// keyed on the literal string 'anonymous', so it was one shared bucket for
// the entire internet rather than per-caller. Anyone who knew the path could
// hold it at its ceiling indefinitely, spending money on every hit and
// denying the operator the diagnostic at the same time. It also published
// the provider's raw error text and the deployment's whole model roster to
// unauthenticated callers.
//
// The rate limit stays, now keyed per admin, because the cheap-but-not-free
// call is still worth bounding against a stuck dashboard tab.

import { NextRequest, NextResponse } from 'next/server'
import { AI_MODELS } from '@/lib/ai/models'
import { openaiFetch } from '@/lib/ai/openaiCompat'
import { checkRateLimit } from '@/lib/rateLimit'
import { getUser } from '@/lib/auth'
import { isPlatformAdminEmail } from '@/lib/auth/platformAdmin'

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

export async function GET(request: NextRequest) {
  const user = await getUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isPlatformAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const rateLimit = await checkRateLimit(user.userId, 'ai-health', 4, 60)
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
