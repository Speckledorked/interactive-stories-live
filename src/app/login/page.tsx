// src/app/login/page.tsx
// Login page — myth design system.

'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { LogIn, AlertTriangle, MailCheck } from 'lucide-react'
import { login } from '@/lib/clientAuth'
import { fontDisplay, fontSans } from '@/lib/fonts'
import { TavernBackground } from '@/components/tavern/TavernBackground'

// Reads ?verified= from the email-verification redirect; isolated in a
// Suspense child because useSearchParams requires it in the app router.
function VerifiedBanner() {
  const searchParams = useSearchParams()
  const verified = searchParams.get('verified')
  if (verified === '1') {
    return (
      <div className="mb-5 flex items-center gap-2 rounded-lg border border-myth-good/30 bg-myth-good/10 px-4 py-3 text-sm text-myth-ink">
        <MailCheck className="h-4 w-4 flex-shrink-0 text-myth-good" />
        <span>Email verified — welcome to MythOS.</span>
      </div>
    )
  }
  if (verified === '0') {
    return (
      <div className="mb-5 flex items-center gap-2 rounded-lg border border-myth-danger/30 bg-myth-danger/10 px-4 py-3 text-sm text-myth-ink">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-myth-danger" />
        <span>That verification link is invalid or already used.</span>
      </div>
    )
  }
  return null
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Preserved across login (e.g. an invite link sent someone here) and
  // forwarded to the signup link too, so the round trip survives either
  // path. Read directly from window.location rather than
  // useSearchParams() to avoid needing a Suspense boundary for the whole
  // page — only an in-app path is accepted, so this can't become an
  // open redirect.
  const returnTo = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('returnTo')
    : null
  const safeReturnTo = returnTo && returnTo.startsWith('/') ? returnTo : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await login(email, password)
      router.push(safeReturnTo || '/campaigns')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`${fontSans.className} -mx-4 -my-8 flex min-h-screen items-center justify-center px-4 py-12`}>
      <TavernBackground variant="myth" />

      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-3">
            <span className="text-xs tracking-widest text-myth-ink-faint">◈──</span>
            <h1 className={`${fontDisplay.className} text-4xl font-semibold tracking-[0.15em] text-myth-ink`}>
              MythOS
            </h1>
            <span className="text-xs tracking-widest text-myth-ink-faint">──◈</span>
          </div>
          <p className="mt-1 text-[11px] tracking-[0.2em] text-myth-ink-faint">THE WORLD REMEMBERS.</p>
        </div>

        <div className="rounded-lg border border-myth-border bg-myth-surface p-8 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.16)]">
          <div className="mb-6 text-center">
            <h2 className={`${fontDisplay.className} text-xl font-semibold text-myth-ink`}>Welcome Back</h2>
            <p className="mt-1 text-sm text-myth-ink-muted">Return to your tales in progress</p>
          </div>

          <Suspense fallback={null}>
            <VerifiedBanner />
          </Suspense>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-myth-danger/30 bg-myth-danger/10 px-4 py-3 text-sm text-myth-ink">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 text-myth-danger" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-semibold text-myth-ink-muted">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-myth-border bg-myth-surface px-4 py-2.5 text-myth-ink placeholder:text-myth-ink-faint focus:border-myth-accent focus:outline-none"
                placeholder="your@email.com"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-semibold text-myth-ink-muted">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-myth-border bg-myth-surface px-4 py-2.5 text-myth-ink placeholder:text-myth-ink-faint focus:border-myth-accent focus:outline-none"
                placeholder="Enter your password"
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-myth-accent px-4 py-3 font-medium text-myth-accent-ink transition-colors hover:bg-myth-accent-hover disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-myth-accent-ink" />
                  Logging in…
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  Login
                </>
              )}
            </button>
          </form>

          <p className="mt-4 text-center">
            <Link href="/auth/forgot-password" className="text-sm text-myth-ink-faint transition-colors hover:text-myth-ink">
              Forgot your password?
            </Link>
          </p>

          <div className="my-6 h-px bg-myth-border" />

          <p className="text-center text-sm text-myth-ink-muted">
            Don&rsquo;t have an account?{' '}
            <Link
              href={safeReturnTo ? `/signup?returnTo=${encodeURIComponent(safeReturnTo)}` : '/signup'}
              className="font-semibold text-myth-accent transition-colors hover:text-myth-accent-hover"
            >
              Sign up for free
            </Link>
          </p>
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/help"
            className="inline-flex items-center gap-1 text-sm text-myth-ink-faint transition-colors hover:text-myth-ink"
          >
            Need help?
          </Link>
        </div>
      </div>
    </div>
  )
}
