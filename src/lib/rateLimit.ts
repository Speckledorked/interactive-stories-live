// src/lib/rateLimit.ts
// Fixed-window rate limiting for the AI-invoking routes. Every LLM call
// costs real money, and until now nothing stopped a burst of requests from
// one user — balance gating caps total spend, not spend velocity.
//
// Postgres-backed (RateLimitCounter) rather than in-memory because the app
// deploys to serverless: each instance has its own memory, so an in-memory
// counter only one lambda can see limits nothing. One upsert per checked
// request is the whole cost, and only the handful of AI routes pay it.

import { NextResponse } from 'next/server'
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
// resolve, start/end scene, downtime) — generous for a human actually
// playing, tight for a script hammering the API.
export const AI_ACTION_LIMIT = { bucket: 'ai-action', limit: 10, windowSeconds: 60 } as const

const PRUNE_RETENTION_MS = 60 * 60 * 1000 // keep at most an hour of windows

export async function checkRateLimit(
  userId: string,
  bucket: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const key = `${userId}:${bucket}`
  const now = Date.now()
  const windowStart = computeWindowStart(now, windowSeconds)

  try {
    const counter = await prisma.rateLimitCounter.upsert({
      where: { key_windowStart: { key, windowStart } },
      create: { key, windowStart },
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
