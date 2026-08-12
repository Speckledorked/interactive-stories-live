// src/lib/rateLimit.ts
// Fixed-window rate limiting for the AI-invoking routes. Every LLM call
// costs real money, and until now nothing stopped a burst of requests from
// one user — balance gating caps total spend, not spend velocity.
//
// Postgres-backed (RateLimitCounter) rather than in-memory because the app
// deploys to serverless: each instance has its own memory, so an in-memory
// counter only one lambda can see limits nothing. One upsert per checked
// request is the whole cost, and only the handful of AI routes pay it.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/** Pure: the start of the fixed window containing `nowMs`. */
export function computeWindowStart(nowMs: number, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000
  return new Date(Math.floor(nowMs / windowMs) * windowMs)
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

// One shared budget across all AI-triggering actions (submit action,
// resolve, start/end scene, downtime, ask-the-GM clarifying questions) —
// generous for a human actually playing, tight for a script hammering the API.
export const AI_ACTION_LIMIT = { bucket: 'ai-action', limit: 10, windowSeconds: 60 } as const

// Lore imports each kick off a background job (an embedding call per
// chunk, up to a whole wiki crawl) — cheap per-request but expensive in
// aggregate, so this gets its own tighter bucket rather than sharing
// ai-action's budget with actual gameplay.
export const LORE_IMPORT_LIMIT = { bucket: 'lore-import', limit: 5, windowSeconds: 60 } as const

// Session revocation (#98). Its own small bucket: it writes to the user row
// on every call and legitimate use is a handful of times ever, so there is
// no reason for it to share gameplay's budget in either direction.
export const SESSION_REVOKE_LIMIT = { bucket: 'session-revoke', limit: 5, windowSeconds: 300 } as const

// #210: the pre-auth surface (login, signup, password reset, email
// verification) has no userId to key on yet — every bucket below is keyed
// by IP (getClientIp) instead, or by email where the target of abuse is a
// specific account rather than the caller (see each route for which).
// Stricter than the gameplay buckets above on purpose: these are the exact
// routes a real attacker targets first (brute force, spam signups, email
// bombing, token guessing), not a script hammering an API a paying player
// already has to be logged into.
export const LOGIN_LIMIT = { bucket: 'login', limit: 10, windowSeconds: 300 } as const
export const SIGNUP_LIMIT = { bucket: 'signup', limit: 5, windowSeconds: 3600 } as const
export const PASSWORD_RESET_REQUEST_LIMIT = { bucket: 'password-reset-request', limit: 3, windowSeconds: 3600 } as const
export const RESET_PASSWORD_LIMIT = { bucket: 'reset-password', limit: 10, windowSeconds: 3600 } as const
export const VERIFY_EMAIL_LIMIT = { bucket: 'verify-email', limit: 10, windowSeconds: 3600 } as const
export const BALANCE_CHECKOUT_LIMIT = { bucket: 'balance-checkout', limit: 10, windowSeconds: 3600 } as const

const PRUNE_RETENTION_MS = 60 * 60 * 1000 // keep at most an hour of windows

/**
 * Best-effort client IP for pre-auth rate limiting. Vercel (and most
 * proxies) set x-forwarded-for; x-real-ip is a common fallback. Falls back
 * to a single shared 'unknown' bucket when neither header is present
 * (local dev, or a proxy that strips them) — safe because checkRateLimit's
 * failure mode is already "fail open," so a shared bucket here just means
 * local dev traffic can rate-limit itself, never that the limiter blocks
 * something it shouldn't.
 */
export function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    // The header is a comma-separated list (client, then each proxy hop) —
    // the first entry is the original client.
    const first = forwardedFor.split(',')[0]?.trim()
    if (first) return first
  }
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  return 'unknown'
}

/**
 * `key` is an opaque rate-limit identity — an authenticated userId for the
 * gameplay buckets above, or (for the pre-auth buckets) a client IP or
 * email address. checkRateLimit itself doesn't care which; it only ever
 * combines it with `bucket` into one counter key.
 */
export async function checkRateLimit(
  key: string,
  bucket: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const counterKey = `${key}:${bucket}`
  const now = Date.now()
  const windowStart = computeWindowStart(now, windowSeconds)

  try {
    const counter = await prisma.rateLimitCounter.upsert({
      where: { key_windowStart: { key: counterKey, windowStart } },
      create: { key: counterKey, windowStart },
      update: { count: { increment: 1 } },
    })

    // Opportunistic pruning, piggybacked on the first request of a window
    // so it costs nothing on the hot path. Awaited (not fire-and-forget)
    // because serverless can freeze the instance right after the response.
    if (counter.count === 1) {
      await prisma.rateLimitCounter.deleteMany({
        where: { windowStart: { lt: new Date(now - PRUNE_RETENTION_MS) } },
      })
    }

    const windowEndMs = windowStart.getTime() + windowSeconds * 1000
    return {
      allowed: counter.count <= limit,
      remaining: Math.max(0, limit - counter.count),
      retryAfterSeconds: Math.max(1, Math.ceil((windowEndMs - now) / 1000)),
    }
  } catch (error) {
    // Fail open: a rate-limiter outage must not take gameplay down with it.
    // The failure mode of "briefly unlimited" is strictly better than
    // "nobody can play".
    console.error('Rate limit check failed (failing open):', error)
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 }
  }
}

export function rateLimitExceededResponse(result: RateLimitResult) {
  return NextResponse.json(
    {
      error: 'Too many requests — give the GM a moment to catch up.',
      retryAfterSeconds: result.retryAfterSeconds,
    },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } }
  )
}
