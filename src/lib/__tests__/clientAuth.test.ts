// src/lib/__tests__/clientAuth.test.ts
//
// The client side of the httpOnly migration: the browser never holds a
// token anymore, so these tests pin what the client DOES hold (display
// data only) and the refresh choreography that replaces the Authorization
// header — one retry on 401, single-flight across concurrent callers so
// two simultaneous 401s cannot rotate the same refresh token twice (the
// second would look like theft server-side).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  setAuth,
  getUser,
  isAuthenticated,
  clearAuth,
  authenticatedFetch,
  refreshSession,
  login,
  logout,
  SIGNED_IN_KEY,
} from '../clientAuth'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  clearAuth()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  clearAuth()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const unauthorized = () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

describe('local session state', () => {
  it('setAuth stores the profile and the signed-in flag, never a token', () => {
    setAuth({ id: 'u1', email: 'a@example.com', name: 'A' })
    expect(getUser()).toEqual({ id: 'u1', email: 'a@example.com', name: 'A' })
    expect(localStorage.getItem(SIGNED_IN_KEY)).toBe('1')
    expect(isAuthenticated()).toBe(true)
    // Nothing credential-shaped is persisted.
    for (let i = 0; i < localStorage.length; i++) {
      const value = localStorage.getItem(localStorage.key(i)!)!
      expect(value).not.toMatch(/eyJ[A-Za-z0-9_-]+\.eyJ/)
    }
  })

  it('isAuthenticated is false with no session', () => {
    expect(isAuthenticated()).toBe(false)
    expect(getUser()).toBeNull()
  })

  it('clearAuth forgets everything', () => {
    setAuth({ id: 'u1', email: 'a@example.com' })
    clearAuth()
    expect(getUser()).toBeNull()
    expect(isAuthenticated()).toBe(false)
    expect(localStorage.getItem(SIGNED_IN_KEY)).toBeNull()
  })

  it('getUser tolerates corrupt storage', () => {
    localStorage.setItem('ai_gm_user', 'not-json{')
    expect(getUser()).toBeNull()
  })
})

describe('authenticatedFetch', () => {
  it('sends no Authorization header — the cookie travels on its own', async () => {
    fetchMock.mockResolvedValue(ok({ data: 1 }))
    await authenticatedFetch('/api/campaigns')
    const [, init] = fetchMock.mock.calls[0]
    const headers = new Headers(init.headers)
    expect(headers.get('Authorization')).toBeNull()
  })

  it('on 401, refreshes once and retries the original request', async () => {
    const calls: string[] = []
    fetchMock.mockImplementation(async (url: string) => {
      calls.push(url)
      if (url === '/api/auth/refresh') return ok({ user: { id: 'u1', email: 'a@example.com' } })
      return calls.filter((c) => c === url).length === 1 ? unauthorized() : ok({ retried: true })
    })

    const res = await authenticatedFetch('/api/campaigns')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ retried: true })
    expect(calls).toEqual(['/api/campaigns', '/api/auth/refresh', '/api/campaigns'])
    // The refreshed session marks the client signed in again.
    expect(isAuthenticated()).toBe(true)
  })

  it('returns the original 401 when the refresh fails', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/auth/refresh' ? unauthorized() : unauthorized()
    )
    const res = await authenticatedFetch('/api/campaigns')
    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('single-flights: concurrent 401s trigger exactly one refresh', async () => {
    // Two simultaneous 401s must not fire two rotations — the second
    // would present an already-consumed token and read as theft.
    const calls: string[] = []
    fetchMock.mockImplementation(async (url: string) => {
      calls.push(url)
      if (url === '/api/auth/refresh') {
        await new Promise((r) => setTimeout(r, 10))
        return ok({ user: { id: 'u1', email: 'a@example.com' } })
      }
      // First hit 401s; the retry after refresh succeeds.
      return calls.filter((c) => c === url).length === 1 ? unauthorized() : ok({ ok: true })
    })

    const [r1, r2] = await Promise.all([
      authenticatedFetch('/api/campaigns'),
      authenticatedFetch('/api/quests'),
    ])
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(calls.filter((c) => c === '/api/auth/refresh')).toHaveLength(1)
  })

  it('never tries to refresh the refresh endpoint itself', async () => {
    fetchMock.mockResolvedValue(unauthorized())
    const res = await authenticatedFetch('/api/auth/refresh')
    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries with the same normalized headers — the JSON content type survives', async () => {
    const seen: (string | null)[] = []
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/refresh') return ok({ user: { id: 'u1', email: 'a@example.com' } })
      seen.push(new Headers(init?.headers).get('Content-Type'))
      return seen.length === 1 ? unauthorized() : ok({ ok: true })
    })

    const res = await authenticatedFetch('/api/data', {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
    })
    expect(res.status).toBe(200)
    // Both the first attempt and the retry carried the content type —
    // rebuilding headers from options on retry used to drop it.
    expect(seen).toEqual(['application/json', 'application/json'])
  })

  it('does not refresh on non-401 failures', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }))
    const res = await authenticatedFetch('/api/campaigns')
    expect(res.status).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('refreshSession', () => {
  it('returns false without throwing when the network fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    await expect(refreshSession()).resolves.toBe(false)
  })

  it('returns false when the refresh token is dead', async () => {
    fetchMock.mockResolvedValue(unauthorized())
    await expect(refreshSession()).resolves.toBe(false)
    expect(isAuthenticated()).toBe(false)
  })
})

describe('proactive refresh', () => {
  it('refreshes ahead of the 15-minute access-cookie expiry', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(ok({ user: { id: 'u1', email: 'a@example.com' } }))

    setAuth({ id: 'u1', email: 'a@example.com' })
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(13 * 60 * 1000)
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/refresh', { method: 'POST' })
  })

  it('clearAuth cancels the scheduled refresh', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(ok({ user: { id: 'u1', email: 'a@example.com' } }))

    setAuth({ id: 'u1', email: 'a@example.com' })
    clearAuth()
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('login / logout', () => {
  it('login stores the user from the body (no token involved)', async () => {
    fetchMock.mockResolvedValue(ok({ user: { id: 'u1', email: 'a@example.com' } }))
    const data = await login('a@example.com', 'pw')
    expect(data.user).toEqual({ id: 'u1', email: 'a@example.com' })
    expect(getUser()?.id).toBe('u1')
    expect(isAuthenticated()).toBe(true)
  })

  it('login surfaces server errors', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 })
    )
    await expect(login('a@example.com', 'wrong')).rejects.toThrow('Invalid credentials')
    expect(isAuthenticated()).toBe(false)
  })

  it('logout revokes server-side and forgets local state', async () => {
    fetchMock.mockResolvedValue(ok({ signedOut: true }))
    setAuth({ id: 'u1', email: 'a@example.com' })

    // happy-dom does not implement navigation; capture the redirect target.
    const hrefSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { set href(v: string) { hrefSpy(v) } },
      writable: true,
      configurable: true,
    })

    logout()

    // keepalive so the revocation POST survives the navigation to /login.
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      keepalive: true,
    })
    expect(isAuthenticated()).toBe(false)
    expect(getUser()).toBeNull()
    expect(hrefSpy).toHaveBeenCalledWith('/login')
  })
})
