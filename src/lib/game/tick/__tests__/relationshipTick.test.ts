import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    faction: { findMany: vi.fn() },
    factionTie: { findMany: vi.fn() },
    war: { findMany: vi.fn() },
    factionDebt: { findMany: vi.fn(async () => []) },
  },
}))

import type { FactionGoal } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { BELIEF_RIVALRY_DISTANCE, decideRelationshipTick, strainOneStep, tickFactionRelationships } from '../relationshipTick'
import type { TickContext } from '../types'
import { simTurn } from '@/lib/game/turnClock'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: simTurn(5), factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any, ...overrides }
}

const NEUTRAL_BELIEFS = { aggression: 50, isolationism: 50, mercantilism: 50, zealotry: 50 }

describe('decideRelationshipTick — belief rivalry distance (28)', () => {
  const inward = (goal: FactionGoal) => ({ goal, stability: 80 })

  it('a 28-point gap on one axis pins a belief rivalry', () => {
    expect(BELIEF_RIVALRY_DISTANCE).toBe(28)
    const result = decideRelationshipTick(inward('DEFEND'), inward('DEFEND'), {
      beliefA: NEUTRAL_BELIEFS,
      beliefB: { ...NEUTRAL_BELIEFS, aggression: 78 },
    })
    expect(result).toEqual({ type: 'RIVAL', pin: 'belief' })
  })

  it('a 27-point gap does not — the goal/stability rules decide instead', () => {
    const result = decideRelationshipTick(inward('DEFEND'), inward('DEFEND'), {
      beliefA: NEUTRAL_BELIEFS,
      beliefB: { ...NEUTRAL_BELIEFS, aggression: 77 },
    })
    expect(result).toEqual({ type: 'ALLY' })
  })
})

describe('strainOneStep — one tie step toward hostility', () => {
  it('ALLY -> NEUTRAL -> RIVAL, and RIVAL stays RIVAL', () => {
    expect(strainOneStep('ALLY')).toBe('NEUTRAL')
    expect(strainOneStep('NEUTRAL')).toBe('RIVAL')
    expect(strainOneStep('RIVAL')).toBe('RIVAL')
  })
})

describe('tickFactionRelationships — default strain persists 5 turns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries defaults resolved within the last 5 turns, not just last turn', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValue([])
    vi.mocked(prisma.factionTie.findMany).mockResolvedValue([])
    vi.mocked(prisma.war.findMany).mockResolvedValue([])

    const result = await tickFactionRelationships(baseCtx())

    expect(vi.mocked(prisma.factionDebt.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'DEFAULTED',
          // turnNumber 5 → defaults resolved at turns 0..5 all strain.
          turnResolved: { gte: 0 },
        }),
      })
    )
    expect(result.changes).toEqual([])
  })
})
