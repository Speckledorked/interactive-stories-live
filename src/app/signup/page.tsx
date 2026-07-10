// src/app/signup/page.tsx
// Signup page — tavern theme

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { UserPlus, AlertTriangle, Check, X } from 'lucide-react'
import { signup } from '@/lib/clientAuth'
import { displayFont, bodyFont } from '@/lib/tavernTheme'
import { TavernBackground } from '@/components/tavern/TavernBackground'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
      router.push('/campaigns')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  const passwordStrength = password.length === 0 ? 0 : password.length < 6 ? 25 : password.length < 8 ? 50 : password.length < 12 ? 75 : 100
  const passwordStrengthColor = passwordStrength < 50 ? 'bg-wine-500' : passwordStrength < 75 ? 'bg-ember-500' : 'bg-success-500'

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
          <p className="text-[11px] tracking-[0.2em] text-ember-300/50 mt-1">YOUR STORY. THE WORLD.</p>
        </div>

        <div className="rounded-2xl bg-gradient-to-br from-tavern-800/80 to-tavern-900/80 border border-ember-900/40 shadow-2xl shadow-black/50 p-8">
          <div className="text-center mb-6">
            <h2 className={`${displayFont.className} text-xl text-ember-100`}>Begin Your Tale</h2>
            <p className="text-ember-300/50 text-sm mt-1">Create an account to start your adventure</p>
          </div>

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
                placeholder="At least 6 characters"
                required
                minLength={6}
                autoComplete="new-password"
              />
              {password.length > 0 && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs text-ember-400/50 mb-1">
                    <span>Password strength</span>
                    <span>{passwordStrength < 50 ? 'Weak' : passwordStrength < 75 ? 'Fair' : passwordStrength < 100 ? 'Good' : 'Strong'}</span>
                  </div>
                  <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${passwordStrengthColor} transition-all duration-300`}
                      style={{ width: `${passwordStrength}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-semibold text-ember-300/70 mb-2">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60"
                placeholder="Re-enter your password"
                required
                minLength={6}
                autoComplete="new-password"
              />
              {confirmPassword.length > 0 && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  {password === confirmPassword ? (
                    <>
                      <Check className="w-4 h-4 text-success-400" />
                      <span className="text-success-400">Passwords match</span>
                    </>
                  ) : (
                    <>
                      <X className="w-4 h-4 text-wine-400" />
                      <span className="text-wine-400">Passwords don&rsquo;t match</span>
                    </>
                  )}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-b from-wine-500 to-wine-700 hover:from-wine-400 hover:to-wine-600 text-ember-100 font-medium border border-ember-900/50 shadow-lg shadow-black/40 transition-all disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="spinner h-5 w-5 border-white" />
                  Creating account…
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Create Account
                </>
              )}
            </button>
          </form>

          <div className="h-px bg-ember-900/30 my-6" />

          <p className="text-center text-ember-300/50 text-sm">
            Already have an account?{' '}
            <Link href="/login" className="text-ember-300 hover:text-ember-200 font-semibold transition-colors">
              Login here
            </Link>
          </p>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-ember-500/40">
            By signing up, you agree to our{' '}
            <Link href="/terms" className="hover:text-ember-300 transition-colors">Terms of Service</Link>
            {' '}and{' '}
            <Link href="/privacy" className="hover:text-ember-300 transition-colors">Privacy Policy</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
