import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignMembership: { findUnique: vi.fn() },
    campaign: { findUnique: vi.fn() },
    campaignLog: { groupBy: vi.fn().mockResolvedValue([]) },
    timelineEvent: { groupBy: vi.fn().mockResolvedValue([]) },
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
  return new NextRequest(`http://localhost/api/campaigns/camp1/logs/calendar${qs}`)
}

const customCalendar = {
  epochLabel: '',
  daysPerWeek: 7,
  weekdayNames: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  months: [{ name: 'Month 1', days: 30 }, { name: 'Month 2', days: 30 }],
  startingYear: 1,
  startingMonthIndex: 0,
  startingDay: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'user1', email: 'user1@example.com' })
})

describe('GET /logs/calendar', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-member', async () => {
    db.campaignMembership.findUnique.mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('404s when the campaign does not exist', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'PLAYER' })
    db.campaign.findUnique.mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(404)
  })

  it('falls back to DEFAULT_CALENDAR when calendarConfig is null', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'PLAYER' })
    db.campaign.findUnique.mockResolvedValue({ calendarConfig: null, worldMeta: { totalElapsedGameHours: 0 } })

    const response = await GET(req(), { params: { id: 'camp1' } })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.monthName).toBe('Month 1')
    expect(json.daysInMonth).toBe(30)
    expect(json.year).toBe(1)
    expect(json.month).toBe(0)
    expect(json.isCurrentMonth).toBe(true)
    expect(json.currentDayOfMonth).toBe(1)
  })

  it('rejects an out-of-range month for the given calendar', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'PLAYER' })
    db.campaign.findUnique.mockResolvedValue({ calendarConfig: customCalendar, worldMeta: { totalElapsedGameHours: 0 } })

    const response = await GET(req('?year=1&month=99'), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('builds markers from campaignLog and timelineEvent groupBy results', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'PLAYER' })
    db.campaign.findUnique.mockResolvedValue({ calendarConfig: customCalendar, worldMeta: { totalElapsedGameHours: 0 } })
    // Month 0 spans absolute days 0-29. Day 5 has a log, day 10 has a rumor,
    // day 5 also has a rumor -- both flags true on the same day.
    db.campaignLog.groupBy.mockResolvedValue([{ inGameDayNumber: 5 }])
    db.timelineEvent.groupBy.mockResolvedValue([{ inGameDayNumber: 5 }, { inGameDayNumber: 10 }])

    const response = await GET(req('?year=1&month=0'), { params: { id: 'camp1' } })
    const json = await response.json()

    // Day 5 is absolute day 5 -> dayOfMonth 6 (startDayNumber 0, +1 offset).
    expect(json.markers['6']).toEqual({ hasLogs: true, hasRumors: true })
    expect(json.markers['11']).toEqual({ hasLogs: false, hasRumors: true })
    expect(json.markers['1']).toBeUndefined()
  })

  it('requests the second month using the explicit query params', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'PLAYER' })
    db.campaign.findUnique.mockResolvedValue({ calendarConfig: customCalendar, worldMeta: { totalElapsedGameHours: 0 } })

    const response = await GET(req('?year=1&month=1'), { params: { id: 'camp1' } })
    const json = await response.json()

    expect(json.monthName).toBe('Month 2')
    expect(json.startDayNumber).toBe(30)
    expect(json.isCurrentMonth).toBe(false)
  })
})
