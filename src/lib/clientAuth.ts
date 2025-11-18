// src/lib/clientAuth.ts
// Client-side authentication utilities
// Handles storing JWT tokens and making authenticated requests

import { AuthResponse } from '@/types/api'

const TOKEN_KEY = 'ai_gm_token'
const USER_KEY = 'ai_gm_user'

/**
 * Store auth token and user info in localStorage
 */
export function setAuth(token: string, user: { id: string; email: string }) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  }
}

/**
 * Get stored auth token
 */
export function getToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(TOKEN_KEY)
  }
  return null
}

/**
 * Get stored user info
 */
export function getUser(): { id: string; email: string } | null {
  if (typeof window !== 'undefined') {
    const userStr = localStorage.getItem(USER_KEY)
    if (userStr) {
      try {
        return JSON.parse(userStr)
      } catch {
        return null
      }
    }
  }
  return null
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return getToken() !== null
}

/**
 * Clear auth data (logout)
 */
export function clearAuth() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  }
}

/**
 * Make an authenticated API request
 * Automatically adds Authorization header
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getToken()

  if (!token) {
    throw new Error('Not authenticated')
  }

  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('Content-Type', 'application/json')

  return fetch(url, {
    ...options,
    headers
  })
}

/**
 * Login helper
 */
export async function login(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Login failed')
  }

  const data: AuthResponse = await response.json()
  setAuth(data.token, data.user)
  return data
}

/**
 * Signup helper
 */
export async function signup(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Signup failed')
  }

  const data: AuthResponse = await response.json()
  setAuth(data.token, data.user)
  return data
}

/**
 * Logout helper
 */
export function logout() {
  clearAuth()
  if (typeof window !== 'undefined') {
    window.location.href = '/login'
  }
}
