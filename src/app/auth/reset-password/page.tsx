// src/app/auth/reset-password/page.tsx
// Set a new password from an emailed reset link — tavern theme.
// The reset email links here as /auth/reset-password?token=...

'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { KeyRound, AlertTriangle } from 'lucide-react'
import { displayFont, bodyFont } from '@/lib/tavernTheme'
import { TavernBackground } from '@/components/tavern/TavernBackground'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password')
      }
      router.push('/login?verified=1')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-wine-800/30 border border-wine-600/40 text-ember-100 text-sm">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 text-wine-400" />
        <span>
          This reset link is missing its token.{' '}
          <Link href="/auth/forgot-password" className="underline">Request a new one.</Link>
        </span>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-wine-800/30 border border-wine-600/40 text-ember-100 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-wine-400" />
          <span>{error}</span>
        </div>
      )}

      <div>
        <label htmlFor="password" className="block text-sm font-semibold text-ember-300/70 mb-2">
          New Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60"
          placeholder="At least 8 characters"
          minLength={8}
          required
          autoComplete="new-password"
        />
      </div>

      <div>
        <label htmlFor="confirm" className="block text-sm font-semibold text-ember-300/70 mb-2">
          Confirm Password
        </label>
        <input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60"
          placeholder="Same again"
          minLength={8}
          required
          autoComplete="new-password"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-b from-wine-500 to-wine-700 hover:from-wine-400 hover:to-wine-600 text-ember-100 font-medium border border-ember-900/50 shadow-lg shadow-black/40 transition-all disabled:opacity-50"
      >
        <KeyRound className="w-4 h-4" />
        {loading ? 'Updating…' : 'Set New Password'}
      </button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className={`${bodyFont.className} -mx-4 -my-8 min-h-screen flex items-center justify-center px-4 py-12`}>
      <TavernBackground />

      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-gradient-to-br from-tavern-800/80 to-tavern-900/80 border border-ember-900/40 shadow-2xl shadow-black/50 p-8">
          <div className="text-center mb-6">
            <h2 className={`${displayFont.className} text-xl text-ember-100`}>Reset Password</h2>
            <p className="text-ember-300/50 text-sm mt-1">Choose a new password for your account</p>
          </div>

          <Suspense fallback={null}>
            <ResetPasswordForm />
          </Suspense>

          <div className="h-px bg-ember-900/30 my-6" />

          <p className="text-center text-ember-300/50 text-sm">
            <Link href="/login" className="text-ember-300 hover:text-ember-200 font-semibold transition-colors">
              Back to login
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
