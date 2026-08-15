import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    faction: { findMany: vi.fn(), update: vi.fn() },
    worldEvent: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { decideBeliefDrift, parseBeliefVector, NEUTRAL_BELIEF, tickBeliefDrift } from '../beliefTick'
import type { TickContext } from '../types'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: 5, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any, ...overrides }
}

describe('parseBeliefVector (#104)', () => {
  it('parses a fully-shaped vector', () => {
    const raw = { aggression: 60, isolationism: 40, mercantilism: 55, zealotry: 20 }
    expect(parseBeliefVector(raw)).toEqual(raw)
  })

  it('returns null for null/undefined/non-object input', () => {
    expect(parseBeliefVector(null)).toBeNull()
    expect(parseBeliefVector(undefined)).toBeNull()
    expect(parseBeliefVector('not an object')).toBeNull()
  })

  it('returns null when any axis is missing', () => {
    expect(parseBeliefVector({ aggression: 60, isolationism: 40, mercantilism: 55 })).toBeNull()
  })

  it('returns null when an axis is not a finite number', () => {
    expect(parseBeliefVector({ aggression: 'high', isolationism: 40, mercantilism: 55, zealotry: 20 })).toBeNull()
    expect(parseBeliefVector({ aggression: NaN, isolationism: 40, mercantilism: 55, zealotry: 20 })).toBeNull()
  })

  it('clamps out-of-range values into 0-100', () => {
    const parsed = parseBeliefVector({ aggression: 150, isolationism: -20, mercantilism: 55, zealotry: 20 })
    expect(parsed).toEqual({ aggression: 100, isolationism: 0, mercantilism: 55, zealotry: 20 })
  })
})

describe('decideBeliefDrift (#104)', () => {
  it('returns the input unchanged when there are no events', () => {
    expect(decideBeliefDrift(NEUTRAL_BELIEF, [])).toEqual(NEUTRAL_BELIEF)
  })

  it('a won war raises aggression and lowers isolationism', () => {
    const next = decideBeliefDrift(NEUTRAL_BELIEF, [{ kind: 'WAR_WON' }])
    expect(next.aggression).toBeGreaterThan(NEUTRAL_BELIEF.aggression)
    expect(next.isolationism).toBeLessThan(NEUTRAL_BELIEF.isolationism)
    expect(next.mercantilism).toBe(NEUTRAL_BELIEF.mercantilism)
    expect(next.zealotry).toBe(NEUTRAL_BELIEF.zealotry)
  })

  it('a lost war lowers aggression and raises isolationism', () => {
    const next = decideBeliefDrift(NEUTRAL_BELIEF, [{ kind: 'WAR_LOST' }])
    expect(next.aggression).toBeLessThan(NEUTRAL_BELIEF.aggression)
    expect(next.isolationism).toBeGreaterThan(NEUTRAL_BELIEF.isolationism)
  })

  it('surviving a collapse ripple raises isolationism only', () => {
    const next = decideBeliefDrift(NEUTRAL_BELIEF, [{ kind: 'COLLAPSE_RIPPLE_SURVIVED' }])
    expect(next.isolationism).toBeGreaterThan(NEUTRAL_BELIEF.isolationism)
    expect(next.aggression).toBe(NEUTRAL_BELIEF.aggression)
    expect(next.mercantilism).toBe(NEUTRAL_BELIEF.mercantilism)
    expect(next.zealotry).toBe(NEUTRAL_BELIEF.zealotry)
  })

  it('a succeeded ambition raises mercantilism only', () => {
    const next = decideBeliefDrift(NEUTRAL_BELIEF, [{ kind: 'AMBITION_SUCCEEDED' }])
    expect(next.mercantilism).toBeGreaterThan(NEUTRAL_BELIEF.mercantilism)
    expect(next.aggression).toBe(NEUTRAL_BELIEF.aggression)
    expect(next.isolationism).toBe(NEUTRAL_BELIEF.isolationism)
    expect(next.zealotry).toBe(NEUTRAL_BELIEF.zealotry)
  })

  it('a failed ambition raises zealotry only', () => {
    const next = decideBeliefDrift(NEUTRAL_BELIEF, [{ kind: 'AMBITION_FAILED' }])
    expect(next.zealotry).toBeGreaterThan(NEUTRAL_BELIEF.zealotry)
    expect(next.aggression).toBe(NEUTRAL_BELIEF.aggression)
    expect(next.isolationism).toBe(NEUTRAL_BELIEF.isolationism)
    expect(next.mercantilism).toBe(NEUTRAL_BELIEF.mercantilism)
  })

  it('folds multiple events in the same batch, each independently clamped', () => {
    const next = decideBeliefDrift(NEUTRAL_BELIEF, [{ kind: 'WAR_WON' }, { kind: 'WAR_WON' }, { kind: 'AMBITION_SUCCEEDED' }])
    expect(next.aggression).toBeGreaterThan(NEUTRAL_BELIEF.aggression + 4) // more than a single event's worth
    expect(next.mercantilism).toBeGreaterThan(NEUTRAL_BELIEF.mercantilism)
  })

  it('never exceeds 0-100 no matter how many events pile up', () => {
    const manyWins = Array.from({ length: 50 }, () => ({ kind: 'WAR_WON' as const }))
    const next = decideBeliefDrift(NEUTRAL_BELIEF, manyWins)
    expect(next.aggression).toBeLessThanOrEqual(100)
    expect(next.isolationism).toBeGreaterThanOrEqual(0)
  })
})

describe('tickBeliefDrift (DB handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when the campaign has no active factions', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([])
    const result = await tickBeliefDrift(baseCtx())
    expect(result.changes).toEqual([])
    expect(prisma.worldEvent.findMany).not.toHaveBeenCalled()
  })

  it('skips a faction with no relevant events from the prior turn', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([{ id: 'f1', name: 'Ashcrown', beliefVector: null }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([])

    const result = await tickBeliefDrift(baseCtx())

    expect(result.changes).toEqual([])
    expect(prisma.faction.update).not.toHaveBeenCalled()
  })

  it('drifts belief and persists it when a war was won', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([{ id: 'f1', name: 'Ashcrown', beliefVector: null }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([
      { type: 'faction.warResolved', newValue: 'attacker', origin: 'tick' },
    ] as any)

    const result = await tickBeliefDrift(baseCtx())

    expect(prisma.faction.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { beliefVector: expect.objectContaining({ aggression: NEUTRAL_BELIEF.aggression + 4 }) },
    })
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({ entityType: 'FACTION', entityId: 'f1', field: 'beliefVector', significant: false, importance: 'NORMAL' })
  })

  it('reads the prior turn only, not full history', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([{ id: 'f1', name: 'Ashcrown', beliefVector: null }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([])

    await tickBeliefDrift(baseCtx({ turnNumber: 12 }))

    expect(prisma.worldEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ turnNumber: 11 }) })
    )
  })

  it('classifies a stalemate war as no signal', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([{ id: 'f1', name: 'Ashcrown', beliefVector: null }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([
      { type: 'faction.warResolved', newValue: 'stalemate', origin: 'tick' },
    ] as any)

    const result = await tickBeliefDrift(baseCtx())

    expect(result.changes).toEqual([])
    expect(prisma.faction.update).not.toHaveBeenCalled()
  })

  it('only treats a stability change as a collapse ripple when its origin is wake', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([{ id: 'f1', name: 'Ashcrown', beliefVector: null }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([
      { type: 'faction.stability', newValue: '45', origin: 'tick' }, // ordinary drift, not a wake ripple
    ] as any)

    const result = await tickBeliefDrift(baseCtx())

    expect(result.changes).toEqual([])
  })

  // #310: same fix as npcDispositionTick.ts's sibling classifier — a
  // FACTION_DEFAULT wake (economyTick.ts's loan-default cascade) writes
  // the identical (FACTION, field: 'stability', origin: 'wake') shape as
  // a genuine death/collapse ripple, so origin alone can't tell them
  // apart. Only the genuine ones should read as a survived collapse.
  it('treats a genuine death/collapse wake ripple (wakeSourceType NPC or FACTION) as a survived collapse', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([{ id: 'f1', name: 'Ashcrown', beliefVector: null }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([
      { type: 'faction.stability', newValue: '45', origin: 'wake', wakeSourceType: 'FACTION' },
    ] as any)

    const result = await tickBeliefDrift(baseCtx())

    expect(prisma.faction.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { beliefVector: expect.objectContaining({ isolationism: NEUTRAL_BELIEF.isolationism + 4 }) },
    })
    expect(result.changes).toHaveLength(1)
  })

  it('#310: does NOT treat a FACTION_DEFAULT wake ripple as a survived collapse', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([{ id: 'f1', name: 'Ashcrown', beliefVector: null }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([
      { type: 'faction.stability', newValue: '45', origin: 'wake', wakeSourceType: 'FACTION_DEFAULT' },
    ] as any)

    const result = await tickBeliefDrift(baseCtx())

    expect(result.changes).toEqual([])
    expect(prisma.faction.update).not.toHaveBeenCalled()
  })

  it('starts from an existing beliefVector rather than always from neutral', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'Ashcrown', beliefVector: { aggression: 90, isolationism: 50, mercantilism: 50, zealotry: 50 } },
    ] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([{ type: 'faction.warResolved', newValue: 'attacker', origin: 'tick' }] as any)

    const result = await tickBeliefDrift(baseCtx())

    expect(prisma.faction.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { beliefVector: expect.objectContaining({ aggression: 94 }) },
    })
    expect(result.changes[0].previousValue).toContain('"aggression":90')
  })

  it('writes nothing in dry-run mode but still reports the changes', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([{ id: 'f1', name: 'Ashcrown', beliefVector: null }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([{ type: 'faction.warResolved', newValue: 'attacker', origin: 'tick' }] as any)

    const result = await tickBeliefDrift(baseCtx({ dryRun: true }))

    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(result.changes).toHaveLength(1)
  })
})
