// src/app/login/page.tsx
// Login page — tavern theme

'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { LogIn, AlertTriangle, MailCheck } from 'lucide-react'
import { login } from '@/lib/clientAuth'
import { displayFont, bodyFont } from '@/lib/tavernTheme'
import { TavernBackground } from '@/components/tavern/TavernBackground'

// Reads ?verified= from the email-verification redirect; isolated in a
// Suspense child because useSearchParams requires it in the app router.
function VerifiedBanner() {
  const searchParams = useSearchParams()
  const verified = searchParams.get('verified')
  if (verified === '1') {
    return (
      <div className="flex items-center gap-2 px-4 py-3 mb-5 rounded-lg bg-ember-900/30 border border-ember-700/40 text-ember-100 text-sm">
        <MailCheck className="w-4 h-4 flex-shrink-0 text-ember-300" />
        <span>Email verified — welcome to the tavern.</span>
      </div>
    )
  }
  if (verified === '0') {
    return (
      <div className="flex items-center gap-2 px-4 py-3 mb-5 rounded-lg bg-wine-800/30 border border-wine-600/40 text-ember-100 text-sm">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 text-wine-400" />
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await login(email, password)
      router.push('/campaigns')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`${bodyFont.className} -mx-4 -my-8 min-h-screen flex items-center justify-center px-4 py-12`}>
      <TavernBackground />

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3">
            <span className="text-ember-700/60 text-xs tracking-widest">◈──</span>
            <h1 className={`${displayFont.className} text-4xl tracking-[0.15em] bg-gradient-to-b from-ember-200 to-ember-500 bg-clip-text text-transparent`}>
              MythOS
            </h1>
            <span className="text-ember-700/60 text-xs tracking-widest">──◈</span>
          </div>
          <p className="text-[11px] tracking-[0.2em] text-ember-300/50 mt-1">THE WORLD REMEMBERS.</p>
        </div>

        <div className="rounded-2xl bg-gradient-to-br from-tavern-800/80 to-tavern-900/80 border border-ember-900/40 shadow-2xl shadow-black/50 p-8">
          <div className="text-center mb-6">
            <h2 className={`${displayFont.className} text-xl text-ember-100`}>Welcome Back</h2>
            <p className="text-ember-300/50 text-sm mt-1">Return to your tales in progress</p>
          </div>

          <Suspense fallback={null}>
            <VerifiedBanner />
          </Suspense>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-wine-800/30 border border-wine-600/40 text-ember-100 text-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-wine-400" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-ember-300/70 mb-2">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60"
                placeholder="your@email.com"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-ember-300/70 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60"
                placeholder="Enter your password"
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-b from-wine-500 to-wine-700 hover:from-wine-400 hover:to-wine-600 text-ember-100 font-medium border border-ember-900/50 shadow-lg shadow-black/40 transition-all disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="spinner h-5 w-5 border-white" />
                  Logging in…
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Login
                </>
              )}
            </button>
          </form>

          <p className="text-center mt-4">
            <Link href="/auth/forgot-password" className="text-sm text-ember-400/60 hover:text-ember-300 transition-colors">
              Forgot your password?
            </Link>
          </p>

          <div className="h-px bg-ember-900/30 my-6" />

          <p className="text-center text-ember-300/50 text-sm">
            Don&rsquo;t have an account?{' '}
            <Link href="/signup" className="text-ember-300 hover:text-ember-200 font-semibold transition-colors">
              Sign up for free
            </Link>
          </p>
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/help"
            className="text-sm text-ember-400/50 hover:text-ember-300 transition-colors inline-flex items-center gap-1"
          >
            Need help?
          </Link>
        </div>
      </div>
    </div>
  )
}
