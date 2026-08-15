// src/app/auth/forgot-password/page.tsx
// Request a password reset link — myth design system.

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { KeyRound, AlertTriangle, MailCheck } from 'lucide-react'
import { fontDisplay, fontSans } from '@/lib/fonts'
import { TavernBackground } from '@/components/tavern/TavernBackground'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
    <div className={`${fontSans.className} -mx-4 -my-8 flex min-h-screen items-center justify-center px-4 py-12`}>
      <TavernBackground variant="myth" />

      <div className="w-full max-w-md">
        <div className="rounded-lg border border-myth-border bg-myth-surface p-8 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.16)]">
          <div className="mb-6 text-center">
            <h2 className={`${fontDisplay.className} text-xl font-semibold text-myth-ink`}>Forgotten Password</h2>
            <p className="mt-1 text-sm text-myth-ink-muted">We&rsquo;ll send a reset link to your email</p>
          </div>

          {sent ? (
            <div className="flex items-center gap-2 rounded-lg border border-myth-good/30 bg-myth-good/10 px-4 py-3 text-sm text-myth-ink">
              <MailCheck className="h-4 w-4 flex-shrink-0 text-myth-good" />
              <span>If an account exists for that email, a reset link is on its way. Check your inbox.</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-myth-danger/30 bg-myth-danger/10 px-4 py-3 text-sm text-myth-ink">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 text-myth-danger" />
                  <span>{error}</span>
                </div>
              )}

              <Input
                id="email"
                type="email"
                label="Email Address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                autoComplete="email"
              />

              <Button type="submit" size="lg" fullWidth loading={loading} icon={KeyRound}>
                {loading ? 'Sending…' : 'Send Reset Link'}
              </Button>
            </form>
          )}

          <div className="my-6 h-px bg-myth-border" />

          <p className="text-center text-sm text-myth-ink-muted">
            Remembered it?{' '}
            <Link href="/login" className="font-semibold text-myth-accent transition-colors hover:text-myth-accent-hover">
              Back to login
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
