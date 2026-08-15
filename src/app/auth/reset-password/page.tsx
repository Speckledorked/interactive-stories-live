// src/app/auth/reset-password/page.tsx
// Set a new password from an emailed reset link — myth design system.
// The reset email links here as /auth/reset-password?token=...

'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { KeyRound, AlertTriangle } from 'lucide-react'
import { fontDisplay, fontSans } from '@/lib/fonts'
import { TavernBackground } from '@/components/tavern/TavernBackground'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
      <div className="flex items-center gap-2 rounded-lg border border-myth-danger/30 bg-myth-danger/10 px-4 py-3 text-sm text-myth-ink">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-myth-danger" />
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
        <div className="flex items-center gap-2 rounded-lg border border-myth-danger/30 bg-myth-danger/10 px-4 py-3 text-sm text-myth-ink">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-myth-danger" />
          <span>{error}</span>
        </div>
      )}

      <Input
        id="password"
        type="password"
        label="New Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="At least 8 characters"
        minLength={8}
        required
        autoComplete="new-password"
      />

      <Input
        id="confirm"
        type="password"
        label="Confirm Password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Same again"
        minLength={8}
        required
        autoComplete="new-password"
      />

      <Button type="submit" size="lg" fullWidth loading={loading} icon={KeyRound}>
        {loading ? 'Updating…' : 'Set New Password'}
      </Button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className={`${fontSans.className} -mx-4 -my-8 flex min-h-screen items-center justify-center px-4 py-12`}>
      <TavernBackground />

      <div className="w-full max-w-md">
        <div className="rounded-lg border border-myth-border bg-myth-surface p-8 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.16)]">
          <div className="mb-6 text-center">
            <h2 className={`${fontDisplay.className} text-xl font-semibold text-myth-ink`}>Reset Password</h2>
            <p className="mt-1 text-sm text-myth-ink-muted">Choose a new password for your account</p>
          </div>

          <Suspense fallback={null}>
            <ResetPasswordForm />
          </Suspense>

          <div className="my-6 h-px bg-myth-border" />

          <p className="text-center text-sm text-myth-ink-muted">
            <Link href="/login" className="inline-flex min-h-[44px] items-center justify-center touch-manipulation font-semibold text-myth-accent transition-colors hover:text-myth-accent-hover">
              Back to login
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
