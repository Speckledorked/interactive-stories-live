// src/lib/api/errors.ts
// The shape nearly every route's catch block hand-rolled: a thrown
// `requireAuth` failure becomes 401 Unauthorized, anything else is logged
// and becomes a generic 500. Centralizes ~30 call sites' worth of the
// identical six lines — same messages, same status codes, same
// console.error convention — with no behavior change at any of them.
//
// Not for routes that use `getUser`/`verifyAuth` (which return `null`
// instead of throwing) — those never have an `'Unauthorized'` to catch
// here, and keep their own inline `if (!user) return 401`.

import { NextResponse } from 'next/server'
import type { ErrorResponse } from '@/types/api'

export function handleRouteError(
  error: unknown,
  logLabel: string,
  fallbackMessage: string
): NextResponse<ErrorResponse> {
  if (error instanceof Error && error.message === 'Unauthorized') {
    return NextResponse.json<ErrorResponse>({ error: 'Unauthorized' }, { status: 401 })
  }
  console.error(`${logLabel}:`, error)
  return NextResponse.json<ErrorResponse>({ error: fallbackMessage }, { status: 500 })
}

// Same job as handleRouteError, for the 7 routes whose 500 response also
// echoes `error.message` back as `details`, and which log unconditionally
// (even on the Unauthorized path) rather than only on the generic-500
// path — both traits matched exactly as they existed at every one of
// those 7 call sites, not simplified to handleRouteError's order.
export function handleRouteErrorWithDetails(
  error: unknown,
  logLabel: string,
  fallbackMessage: string
): NextResponse<ErrorResponse> {
  console.error(`${logLabel}:`, error)
  if (error instanceof Error && error.message === 'Unauthorized') {
    return NextResponse.json<ErrorResponse>({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json<ErrorResponse>(
    { error: fallbackMessage, details: error instanceof Error ? error.message : 'Unknown error' },
    { status: 500 }
  )
}
