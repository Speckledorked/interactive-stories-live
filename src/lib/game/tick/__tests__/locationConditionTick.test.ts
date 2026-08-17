import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    location: { findMany: vi.fn(), update: vi.fn() },
    war: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { decideConditionDrift, deriveConditionTags, explainConditionDrift, tickLocationCondition } from '../locationConditionTick'
import type { TickContext } from '../types'
import { simTurn } from '@/lib/game/turnClock'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: simTurn(5), factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any, ...overrides }
}

describe('decideConditionDrift (#109)', () => {
  it('damages a location under active war at a fixed rate', () => {
    const result = decideConditionDrift({ conditionScore: 60 }, true, false)
    expect(result.nextConditionScore).toBe(52) // 60 - 8
  })

  it('war damage applies even if the location happens to also be contested', () => {
    const result = decideConditionDrift({ conditionScore: 60 }, true, true)
    expect(result.nextConditionScore).toBe(52) // war takes priority over mere contest
  })

  it('strains a merely-contested (no active war) location at a smaller rate', () => {
    const result = decideConditionDrift({ conditionScore: 60 }, false, true)
    expect(result.nextConditionScore).toBe(58) // 60 - 2
  })

  it('recovers a damaged location toward baseline in peacetime', () => {
    const result = decideConditionDrift({ conditionScore: 40 }, false, false)
    expect(result.nextConditionScore).toBe(41) // 40 + 1
  })

  it('holds steady at or above baseline in peacetime — nothing decays a thriving place for no reason', () => {
    expect(decideConditionDrift({ conditionScore: 60 }, false, false).nextConditionScore).toBe(60)
    expect(decideConditionDrift({ conditionScore: 90 }, false, false).nextConditionScore).toBe(90)
  })

  it('clamps at 0 rather than going negative under repeated war damage', () => {
    const result = decideConditionDrift({ conditionScore: 5 }, true, false)
    expect(result.nextConditionScore).toBe(0)
  })

  it('clamps at 100 rather than exceeding it', () => {
    const result = decideConditionDrift({ conditionScore: 99 }, false, false, 5)
    expect(result.nextConditionScore).toBe(100)
  })

  it('accepts an optional seasonModifier and folds it into the delta', () => {
    const withoutSeason = decideConditionDrift({ conditionScore: 60 }, false, true)
    const withSeason = decideConditionDrift({ conditionScore: 60 }, false, true, -3)
    expect(withSeason.nextConditionScore).toBe(withoutSeason.nextConditionScore - 3)
  })

  it('defaults seasonModifier to 0 when omitted', () => {
    const withDefault = decideConditionDrift({ conditionScore: 60 }, true, false)
    const explicitZero = decideConditionDrift({ conditionScore: 60 }, true, false, 0)
    expect(withDefault).toEqual(explicitZero)
  })
})

describe('explainConditionDrift (#126) — decideConditionDrift is a thin wrapper over this', () => {
  it('produces the same nextConditionScore as decideConditionDrift for every branch', () => {
    const cases: Array<[{ conditionScore: number }, boolean, boolean, number?]> = [
      [{ conditionScore: 60 }, true, false],
      [{ conditionScore: 60 }, true, true],
      [{ conditionScore: 60 }, false, true],
      [{ conditionScore: 40 }, false, false],
      [{ conditionScore: 60 }, false, false],
      [{ conditionScore: 5 }, true, false],
      [{ conditionScore: 99 }, false, false, 5],
    ]
    for (const [location, warPresent, isContested, seasonModifier] of cases) {
      expect(explainConditionDrift(location, warPresent, isContested, seasonModifier).nextConditionScore)
        .toBe(decideConditionDrift(location, warPresent, isContested, seasonModifier).nextConditionScore)
    }
  })

  it('explains war damage', () => {
    const { reasoning } = explainConditionDrift({ conditionScore: 60 }, true, false)
    expect(reasoning.join(' ')).toMatch(/ongoing war/i)
  })

  it('explains contest strain when no war is active', () => {
    const { reasoning } = explainConditionDrift({ conditionScore: 60 }, false, true)
    expect(reasoning.join(' ')).toMatch(/contested rule/i)
  })

  it('explains peacetime recovery below baseline', () => {
    const { reasoning } = explainConditionDrift({ conditionScore: 40 }, false, false)
    expect(reasoning.join(' ')).toMatch(/recovering/i)
  })

  it('explains holding steady at or above baseline', () => {
    const { reasoning } = explainConditionDrift({ conditionScore: 60 }, false, false)
    expect(reasoning.join(' ')).toMatch(/holding steady/i)
  })

  it('mentions the season modifier only when non-zero', () => {
    const withSeason = explainConditionDrift({ conditionScore: 60 }, false, false, -3)
    expect(withSeason.reasoning.join(' ')).toMatch(/season modifier/i)
    const withoutSeason = explainConditionDrift({ conditionScore: 60 }, false, false)
    expect(withoutSeason.reasoning.join(' ')).not.toMatch(/season modifier/i)
  })

  it('always reports the projected next score in the trace', () => {
    const { reasoning, nextConditionScore } = explainConditionDrift({ conditionScore: 60 }, true, false)
    expect(reasoning.join(' ')).toContain(String(nextConditionScore))
  })
})

describe('deriveConditionTags (#109)', () => {
  it('is ABANDONED only at exactly 0', () => {
    expect(deriveConditionTags(0, false)).toEqual(['ABANDONED'])
  })

  it('is RUINED just above 0, up to the RUINED/DAMAGED boundary', () => {
    expect(deriveConditionTags(1, false)).toEqual(['RUINED'])
    expect(deriveConditionTags(24, false)).toEqual(['RUINED'])
  })

  it('is DAMAGED between the RUINED and STABLE boundaries', () => {
    expect(deriveConditionTags(25, false)).toEqual(['DAMAGED'])
    expect(deriveConditionTags(49, false)).toEqual(['DAMAGED'])
  })

  it('is STABLE between the DAMAGED and PROSPEROUS boundaries', () => {
    expect(deriveConditionTags(50, false)).toEqual(['STABLE'])
    expect(deriveConditionTags(74, false)).toEqual(['STABLE'])
  })

  it('is PROSPEROUS at or above 75', () => {
    expect(deriveConditionTags(75, false)).toEqual(['PROSPEROUS'])
    expect(deriveConditionTags(100, false)).toEqual(['PROSPEROUS'])
  })

  it('adds CONTESTED as an overlay on top of any band, mirrored from isContested', () => {
    expect(deriveConditionTags(80, true)).toEqual(['PROSPEROUS', 'CONTESTED'])
    expect(deriveConditionTags(10, true)).toEqual(['RUINED', 'CONTESTED'])
  })

  it('never returns CONTESTED on its own without a score-derived band', () => {
    const tags = deriveConditionTags(50, true)
    expect(tags[0]).not.toBe('CONTESTED')
    expect(tags).toContain('CONTESTED')
  })
})

describe('tickLocationCondition (DB handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns no changes when the campaign has no locations', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([])
    const result = await tickLocationCondition(baseCtx())
    expect(result.changes).toEqual([])
    expect(prisma.war.findMany).not.toHaveBeenCalled()
  })

  it('damages a location contested by an ESCALATING war', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc-1', name: 'The Keep', conditionScore: 60, isContested: true },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([{ contestedLocationId: 'loc-1' }] as any)

    const result = await tickLocationCondition(baseCtx())

    expect(prisma.location.update).toHaveBeenCalledWith({ where: { id: 'loc-1' }, data: { conditionScore: 52 } })
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({ entityType: 'LOCATION_CONDITION', significant: true, importance: 'MAJOR' })
  })

  it('does not treat a location as at-war just because a DIFFERENT war is escalating', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc-1', name: 'The Keep', conditionScore: 60, isContested: false },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([{ contestedLocationId: 'loc-2' }] as any)

    const result = await tickLocationCondition(baseCtx())

    expect(result.changes).toEqual([])
    expect(prisma.location.update).not.toHaveBeenCalled()
  })

  it('recovers a damaged location in peacetime and marks the change routine, not significant', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc-1', name: 'The Docks', conditionScore: 40, isContested: false },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([])

    const result = await tickLocationCondition(baseCtx())

    expect(prisma.location.update).toHaveBeenCalledWith({ where: { id: 'loc-1' }, data: { conditionScore: 41 } })
    expect(result.changes[0]).toMatchObject({ significant: false, importance: 'NORMAL' })
  })

  it('skips a location whose score would not actually change', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc-1', name: 'The Square', conditionScore: 60, isContested: false },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([])

    const result = await tickLocationCondition(baseCtx())

    expect(result.changes).toEqual([])
    expect(prisma.location.update).not.toHaveBeenCalled()
  })

  it('writes nothing in dry-run mode but still reports the changes', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc-1', name: 'The Keep', conditionScore: 60, isContested: true },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([{ contestedLocationId: 'loc-1' }] as any)

    const result = await tickLocationCondition(baseCtx({ dryRun: true }))

    expect(prisma.location.update).not.toHaveBeenCalled()
    expect(result.changes).toHaveLength(1)
  })
})
