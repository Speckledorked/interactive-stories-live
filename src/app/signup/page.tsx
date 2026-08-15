// src/app/signup/page.tsx
// Signup page — myth design system.

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { UserPlus, AlertTriangle, Check, X } from 'lucide-react'
import { signup } from '@/lib/clientAuth'
import { fontDisplay, fontSans } from '@/lib/fonts'
import { TavernBackground } from '@/components/tavern/TavernBackground'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Preserved across the signup form (e.g. an invite link sent someone
  // here to make an account first) and forwarded to the login link too,
  // so the round trip survives either path. Read directly from
  // window.location rather than useSearchParams() to avoid needing a
  // Suspense boundary for this whole page.
  const returnTo = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('returnTo')
    : null
  const safeReturnTo = returnTo && returnTo.startsWith('/') ? returnTo : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setLoading(true)

    try {
      await signup(email, password)
      router.push(safeReturnTo || '/campaigns')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  const passwordStrength = password.length === 0 ? 0 : password.length < 6 ? 25 : password.length < 8 ? 50 : password.length < 12 ? 75 : 100
  const passwordStrengthColor = passwordStrength < 50 ? 'bg-myth-danger' : passwordStrength < 75 ? 'bg-myth-warn' : 'bg-myth-good'

  return (
    <div className={`${fontSans.className} -mx-4 -my-8 flex min-h-screen items-center justify-center px-4 py-12`}>
      <TavernBackground />

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
            <h2 className={`${fontDisplay.className} text-xl font-semibold text-myth-ink`}>Begin Your Tale</h2>
            <p className="mt-1 text-sm text-myth-ink-muted">Create an account to start your adventure</p>
          </div>

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

            <div>
              <Input
                id="password"
                type="password"
                label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                minLength={6}
                autoComplete="new-password"
              />
              {password.length > 0 && (
                <div className="mt-2">
                  <div className="mb-1 flex items-center justify-between text-xs text-myth-ink-faint">
                    <span>Password strength</span>
                    <span>{passwordStrength < 50 ? 'Weak' : passwordStrength < 75 ? 'Fair' : passwordStrength < 100 ? 'Good' : 'Strong'}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-myth-border">
                    <div
                      className={`h-full ${passwordStrengthColor} transition-all duration-300`}
                      style={{ width: `${passwordStrength}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div>
              <Input
                id="confirmPassword"
                type="password"
                label="Confirm Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                required
                minLength={6}
                autoComplete="new-password"
              />
              {confirmPassword.length > 0 && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  {password === confirmPassword ? (
                    <>
                      <Check className="h-4 w-4 text-myth-good" />
                      <span className="text-myth-good">Passwords match</span>
                    </>
                  ) : (
                    <>
                      <X className="h-4 w-4 text-myth-danger" />
                      <span className="text-myth-danger">Passwords don&rsquo;t match</span>
                    </>
                  )}
                </div>
              )}
            </div>

            <Button type="submit" size="lg" fullWidth loading={loading} icon={UserPlus}>
              {loading ? 'Creating account…' : 'Create Account'}
            </Button>
          </form>

          <div className="my-6 h-px bg-myth-border" />

          <p className="text-center text-sm text-myth-ink-muted">
            Already have an account?{' '}
            <Link
              href={safeReturnTo ? `/login?returnTo=${encodeURIComponent(safeReturnTo)}` : '/login'}
              className="font-semibold text-myth-accent transition-colors hover:text-myth-accent-hover"
            >
              Login here
            </Link>
          </p>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-myth-ink-faint">
            By signing up, you agree to our{' '}
            <Link href="/terms" className="transition-colors hover:text-myth-ink">Terms of Service</Link>
            {' '}and{' '}
            <Link href="/privacy" className="transition-colors hover:text-myth-ink">Privacy Policy</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
