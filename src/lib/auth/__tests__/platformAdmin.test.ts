// src/lib/auth/__tests__/platformAdmin.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isPlatformAdminEmail } from '../platformAdmin'

describe('isPlatformAdminEmail', () => {
  const original = process.env.PLATFORM_ADMIN_EMAILS

  afterEach(() => {
    process.env.PLATFORM_ADMIN_EMAILS = original
  })

  it('denies everyone when unset', () => {
    delete process.env.PLATFORM_ADMIN_EMAILS
    expect(isPlatformAdminEmail('anyone@example.com')).toBe(false)
  })

  it('matches emails in the comma-separated allowlist, case-insensitively', () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'Owner@Example.com, second@example.com'
    expect(isPlatformAdminEmail('owner@example.com')).toBe(true)
    expect(isPlatformAdminEmail('second@example.com')).toBe(true)
    expect(isPlatformAdminEmail('nobody@example.com')).toBe(false)
  })

  it('handles null/undefined/empty input', () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'owner@example.com'
    expect(isPlatformAdminEmail(null)).toBe(false)
    expect(isPlatformAdminEmail(undefined)).toBe(false)
    expect(isPlatformAdminEmail('')).toBe(false)
  })
})
