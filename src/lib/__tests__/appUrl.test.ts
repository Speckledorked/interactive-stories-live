// src/lib/__tests__/appUrl.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { getAppUrl } from '../appUrl'

describe('getAppUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('prefers NEXT_PUBLIC_APP_URL when set', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.com')
    vi.stubEnv('VERCEL_URL', 'some-preview.vercel.app')
    expect(getAppUrl()).toBe('https://example.com')
  })

  it('falls back to VERCEL_URL when NEXT_PUBLIC_APP_URL is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    vi.stubEnv('VERCEL_URL', 'some-preview.vercel.app')
    expect(getAppUrl()).toBe('https://some-preview.vercel.app')
  })

  it('falls back to localhost when neither is set', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    vi.stubEnv('VERCEL_URL', '')
    expect(getAppUrl()).toBe('http://localhost:3000')
  })
})
