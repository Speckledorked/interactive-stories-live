// src/app/signup/page.tsx
// Signup page

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signup } from '@/lib/clientAuth'

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

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    // Validate password length
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
  const passwordStrengthColor = passwordStrength < 50 ? 'bg-danger-500' : passwordStrength < 75 ? 'bg-warning-500' : 'bg-success-500'

  return (
    <div className="flex items-center justify-center min-h-screen py-12 px-4 animate-fade-in">
      {/* Background decoration */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-accent-500/10 rounded-full blur-3xl"></div>
      </div>

      <div className="w-full max-w-md">
        <div className="card relative overflow-hidden shadow-elevated">
          {/* Top gradient decoration */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary-600 via-primary-500 to-accent-500"></div>

          <div className="text-center mb-8 mt-2">
            <div className="w-20 h-20 bg-gradient-to-br from-primary-600 to-primary-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary-500/30">
              <span className="text-white font-bold text-4xl">🎲</span>
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent mb-2">
              Create Account
            </h1>
            <p className="text-gray-400">
              Start your AI GM adventure today
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-gradient-to-r from-danger-500/10 to-danger-600/5 border border-danger-500/30 text-danger-400 px-4 py-3 rounded-xl backdrop-blur-sm animate-slide-up">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="font-medium">{error}</span>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-gray-300 mb-2">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="your@email.com"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-gray-300 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field"
                placeholder="At least 6 characters"
                required
                minLength={6}
                autoComplete="new-password"
              />
              {password.length > 0 && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>Password strength</span>
                    <span>{passwordStrength < 50 ? 'Weak' : passwordStrength < 75 ? 'Fair' : passwordStrength < 100 ? 'Good' : 'Strong'}</span>
                  </div>
                  <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${passwordStrengthColor} transition-all duration-300`}
                      style={{ width: `${passwordStrength}%` }}
                    ></div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-semibold text-gray-300 mb-2">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-field"
                placeholder="Re-enter your password"
                required
                minLength={6}
                autoComplete="new-password"
              />
              {confirmPassword.length > 0 && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  {password === confirmPassword ? (
                    <>
                      <svg className="w-4 h-4 text-success-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-success-400">Passwords match</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 text-danger-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <span className="text-danger-400">Passwords don't match</span>
                    </>
                  )}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary shadow-glow"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="spinner h-5 w-5 border-white"></div>
                  Creating account...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  Create Account
                </span>
              )}
            </button>
          </form>

          <div className="divider my-6"></div>

          <div className="text-center">
            <p className="text-gray-400 text-sm">
              Already have an account?{' '}
              <Link href="/login" className="text-primary-400 hover:text-primary-300 font-semibold transition-colors">
                Login here
              </Link>
            </p>
          </div>
        </div>

        {/* Footer note */}
        <div className="mt-6 text-center">
          <p className="text-xs text-gray-500">
            By signing up, you agree to our{' '}
            <Link href="/terms" className="hover:text-gray-400 transition-colors">Terms of Service</Link>
            {' '}and{' '}
            <Link href="/privacy" className="hover:text-gray-400 transition-colors">Privacy Policy</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
