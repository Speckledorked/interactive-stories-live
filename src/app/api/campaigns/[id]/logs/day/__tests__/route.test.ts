import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignMembership: { findUnique: vi.fn() },
    campaignLog: { findMany: vi.fn().mockResolvedValue([]) },
    timelineEvent: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock('@/lib/auth', () => ({
  getUser: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { GET } from '../route'

const db = prisma as any

function req(qs = '') {
  return new NextRequest(`http://localhost/api/campaigns/camp1/logs/day${qs}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'user1', email: 'user1@example.com' })
})

describe('GET /logs/day', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(req('?dayNumber=5'), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-member', async () => {
    db.campaignMembership.findUnique.mockResolvedValue(null)
    const response = await GET(req('?dayNumber=5'), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('rejects a missing or non-numeric dayNumber', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'PLAYER' })
    expect((await GET(req(''), { params: { id: 'camp1' } })).status).toBe(400)
    expect((await GET(req('?dayNumber=abc'), { params: { id: 'camp1' } })).status).toBe(400)
  })

  it('returns logs and rumors for the requested day', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'PLAYER' })
    db.campaignLog.findMany.mockResolvedValue([{ id: 'log1', title: 'A scene', inGameDayNumber: 5 }])
    db.timelineEvent.findMany.mockResolvedValue([
      { id: 'evt1', turnNumber: 3, title: 'Rumor Title', summaryPublic: 'Word on the street.' },
    ])

    const response = await GET(req('?dayNumber=5'), { params: { id: 'camp1' } })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.logs).toEqual([{ id: 'log1', title: 'A scene', inGameDayNumber: 5 }])
    expect(json.rumors).toEqual([{ id: 'evt1', turnNumber: 3, title: 'Rumor Title', summary: 'Word on the street.' }])
  })

  it('queries timelineEvent with a select that excludes summaryGM/gmNotes', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'PLAYER' })

    await GET(req('?dayNumber=5'), { params: { id: 'camp1' } })

    const call = db.timelineEvent.findMany.mock.calls[0][0]
    expect(call.select).toEqual({ id: true, turnNumber: true, title: true, summaryPublic: true })
    expect(call.select.summaryGM).toBeUndefined()
    expect(call.select.gmNotes).toBeUndefined()
  })

  it('scopes both queries to the campaign and requested day', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'PLAYER' })

    await GET(req('?dayNumber=42'), { params: { id: 'camp1' } })

    expect(db.campaignLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: 'camp1', inGameDayNumber: 42 } })
    )
    expect(db.timelineEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ campaignId: 'camp1', inGameDayNumber: 42, isOffscreen: true }),
      })
    )
  })
})
