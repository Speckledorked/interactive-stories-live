import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    worldMeta: { update: vi.fn().mockResolvedValue({}) },
    campaign: { update: vi.fn().mockResolvedValue({}) },
  },
}))

vi.mock('@/lib/ai/calendarGenerator', () => ({
  generateCalendar: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { generateCalendar } from '@/lib/ai/calendarGenerator'
import { resolveLegacyCalendar } from '../calendarBackfill'
import { DEFAULT_CALENDAR, type GeneratedCalendar } from '../calendar'

const campaign = { id: 'campaign-1', title: 'The Iron Vigil', description: 'desc', universe: 'Grimdark Fantasy' }

const customCalendar: GeneratedCalendar = {
  epochLabel: 'Age of Ash',
  daysPerWeek: 5,
  weekdayNames: ['A', 'B', 'C', 'D', 'E'],
  months: [{ name: 'One', days: 30 }],
  startingYear: 1,
  startingMonthIndex: 0,
  startingDay: 1,
}

describe('resolveLegacyCalendar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses a real generated calendar when generation succeeds', async () => {
    vi.mocked(generateCalendar).mockResolvedValue(customCalendar)
    const result = await resolveLegacyCalendar(campaign, { currentInGameDate: 'Day 1', totalElapsedGameHours: 0 })
    expect(result.calendar).toEqual(customCalendar)
    expect(prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: 'campaign-1' },
      data: { calendarConfig: customCalendar },
    })
  })

  it('falls back to DEFAULT_CALENDAR when generation fails', async () => {
    vi.mocked(generateCalendar).mockResolvedValue(null)
    const result = await resolveLegacyCalendar(campaign, { currentInGameDate: 'Day 1', totalElapsedGameHours: 0 })
    expect(result.calendar).toEqual(DEFAULT_CALENDAR)
  })

  it('recovers hours from a clean legacy "Day N" string when totalElapsedGameHours is still 0', async () => {
    vi.mocked(generateCalendar).mockResolvedValue(customCalendar)
    const result = await resolveLegacyCalendar(campaign, { currentInGameDate: 'Day 5', totalElapsedGameHours: 0 })
    expect(result.totalElapsedGameHours).toBe(96) // (5-1)*24
    expect(prisma.worldMeta.update).toHaveBeenCalledWith({
      where: { campaignId: 'campaign-1' },
      data: { totalElapsedGameHours: 96 },
    })
  })

  it('does not recover or overwrite hours when totalElapsedGameHours is already non-zero', async () => {
    vi.mocked(generateCalendar).mockResolvedValue(customCalendar)
    const result = await resolveLegacyCalendar(campaign, { currentInGameDate: 'Day 5', totalElapsedGameHours: 42 })
    expect(result.totalElapsedGameHours).toBe(42)
    expect(prisma.worldMeta.update).not.toHaveBeenCalled()
  })

  it('does not recover hours from a degraded "<date> + N days" legacy string', async () => {
    vi.mocked(generateCalendar).mockResolvedValue(customCalendar)
    const result = await resolveLegacyCalendar(campaign, { currentInGameDate: 'Day 5 + 2 days', totalElapsedGameHours: 0 })
    expect(result.totalElapsedGameHours).toBe(0)
    expect(prisma.worldMeta.update).not.toHaveBeenCalled()
  })

  it('never throws if the backfill writes fail', async () => {
    vi.mocked(generateCalendar).mockResolvedValue(customCalendar)
    vi.mocked(prisma.campaign.update).mockRejectedValueOnce(new Error('db down'))
    vi.mocked(prisma.worldMeta.update).mockRejectedValueOnce(new Error('db down'))
    await expect(
      resolveLegacyCalendar(campaign, { currentInGameDate: 'Day 5', totalElapsedGameHours: 0 })
    ).resolves.toMatchObject({ calendar: customCalendar })
  })
})
