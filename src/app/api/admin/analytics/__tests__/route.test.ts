// src/app/api/admin/analytics/__tests__/route.test.ts
// #135 (cont.) — the platform-wide analytics dashboard had no test
// coverage: that it gates on PLATFORM_ADMIN_EMAILS (an operator-level
// allowlist), NOT campaign membership/role — a campaign admin who isn't
// a platform admin must still be rejected — was unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/auth/platformAdmin', () => ({ isPlatformAdminEmail: vi.fn() }))
vi.mock('@/lib/analytics/events', () => ({
  getFunnelCounts: vi.fn(),
  getSignupsByDay: vi.fn(),
  getRetentionByCohortWeek: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    resolutionJob: { findMany: vi.fn() },
    loreImportJob: { findMany: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { isPlatformAdminEmail } from '@/lib/auth/platformAdmin'
import { getFunnelCounts, getSignupsByDay, getRetentionByCohortWeek } from '@/lib/analytics/events'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/admin/analytics')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'u1', email: 'admin@example.com' })
  ;(isPlatformAdminEmail as any).mockReturnValue(true)
  ;(getFunnelCounts as any).mockResolvedValue({})
  ;(getSignupsByDay as any).mockResolvedValue([])
  ;(getRetentionByCohortWeek as any).mockResolvedValue([])
  db.resolutionJob.findMany.mockResolvedValue([])
  db.loreImportJob.findMany.mockResolvedValue([])
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(req())
    expect(response.status).toBe(401)
    expect(getFunnelCounts).not.toHaveBeenCalled()
  })

  it('rejects a non-platform-admin, even a campaign admin', async () => {
    ;(isPlatformAdminEmail as any).mockReturnValue(false)
    const response = await GET(req())
    expect(response.status).toBe(403)
    expect(getFunnelCounts).not.toHaveBeenCalled()
  })

  it('returns funnel, signup, retention, and stuck-job data for a platform admin', async () => {
    ;(getFunnelCounts as any).mockResolvedValue({ signups: 10 })
    db.resolutionJob.findMany.mockResolvedValue([{ id: 'j1' }])
    const response = await GET(req())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.funnel).toEqual({ signups: 10 })
    expect(body.stuckResolutionJobs).toEqual([{ id: 'j1' }])
  })

  it('queries stuck jobs by the alerted-OR-abandoned-failure signature', async () => {
    await GET(req())
    expect(db.resolutionJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ alertedStuckAt: { not: null } }, { status: 'FAILED', lastError: { contains: 'Abandoned' } }] },
    }))
  })
})
