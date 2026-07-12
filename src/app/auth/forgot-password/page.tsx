// src/app/auth/forgot-password/page.tsx
// Request a password reset link — tavern theme

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { KeyRound, AlertTriangle, MailCheck } from 'lucide-react'
import { displayFont, bodyFont } from '@/lib/tavernTheme'
import { TavernBackground } from '@/components/tavern/TavernBackground'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const response = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Something went wrong')
      }
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`${bodyFont.className} -mx-4 -my-8 min-h-screen flex items-center justify-center px-4 py-12`}>
      <TavernBackground />

      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-gradient-to-br from-tavern-800/80 to-tavern-900/80 border border-ember-900/40 shadow-2xl shadow-black/50 p-8">
          <div className="text-center mb-6">
            <h2 className={`${displayFont.className} text-xl text-ember-100`}>Forgotten Password</h2>
            <p className="text-ember-300/50 text-sm mt-1">We&rsquo;ll send a reset link to your email</p>
          </div>

          {sent ? (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-ember-900/30 border border-ember-700/40 text-ember-100 text-sm">
              <MailCheck className="w-4 h-4 flex-shrink-0 text-ember-300" />
              <span>If an account exists for that email, a reset link is on its way. Check your inbox.</span>
            </div>
          ) : (
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

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-b from-wine-500 to-wine-700 hover:from-wine-400 hover:to-wine-600 text-ember-100 font-medium border border-ember-900/50 shadow-lg shadow-black/40 transition-all disabled:opacity-50"
              >
                <KeyRound className="w-4 h-4" />
                {loading ? 'Sending…' : 'Send Reset Link'}
              </button>
            </form>
          )}

          <div className="h-px bg-ember-900/30 my-6" />

          <p className="text-center text-ember-300/50 text-sm">
            Remembered it?{' '}
            <Link href="/login" className="text-ember-300 hover:text-ember-200 font-semibold transition-colors">
              Back to login
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
