// src/lib/game/__tests__/questFailure.test.ts
//
// What a failed quest costs — the open half of #45/#75.
//
// The structure to have consequences landed then (a stable objectiveKey, a
// real FK to the giver) and FAILED/ABANDONED stayed inert, because the cost
// was a design question rather than a plumbing one. The answer these cover:
// the cost is contextual, and the context is state the engine already owns
// — who commissioned the job, and how it ended — never a number the
// narrator picks.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  decideQuestFailureCost,
  hasQuestGiver,
  applyQuestFailureCost,
  ABANDON_STANDING_DELTA,
  ABANDON_TRUST_DELTA,
  FAILED_RESPECT_DELTA,
} from '../questFailure'

describe('decideQuestFailureCost', () => {
  it('charges a walk-away to trust, and to standing', () => {
    // Abandoning is a broken commitment.
    const cost = decideQuestFailureCost('ABANDONED', 'The Ledger Job')
    expect(cost.trustDelta).toBe(ABANDON_TRUST_DELTA)
    expect(cost.standingDelta).toBe(ABANDON_STANDING_DELTA)
    expect(cost.trustDelta).toBeLessThan(0)
  })

  it('charges an honest failure to respect only', () => {
    // You were not up to it; you did not lie. The distinction is the whole
    // point — a system that punished both identically would teach players
    // to abandon quietly rather than fail publicly.
    const cost = decideQuestFailureCost('FAILED', 'The Ledger Job')
    expect(cost.respectDelta).toBe(FAILED_RESPECT_DELTA)
    expect(cost.trustDelta).toBe(0)
    expect(cost.standingDelta).toBe(0)
  })

  it('distinguishes the two outcomes by which meter moves, not just by size', () => {
    // Trust and respect feed relationshipModifier independently, so using
    // different meters says something true about the fiction instead of
    // scaling one number twice.
    const abandoned = decideQuestFailureCost('ABANDONED', 'q')
    const failed = decideQuestFailureCost('FAILED', 'q')
    expect(abandoned.trustDelta).not.toBe(failed.trustDelta)
    expect(failed.standingDelta).toBe(0)
    expect(abandoned.standingDelta).not.toBe(0)
  })

  it('names the quest in a line a player could read', () => {
    for (const status of ['FAILED', 'ABANDONED'] as const) {
      const cost = decideQuestFailureCost(status, 'The Ledger Job')
      expect(cost.reason).toContain('The Ledger Job')
      expect(cost.reason).not.toMatch(/\d/)
    }
  })
})

describe('hasQuestGiver', () => {
  it('recognizes either kind of resolved giver', () => {
    expect(hasQuestGiver({ givenByNpcId: 'npc1' })).toBe(true)
    expect(hasQuestGiver({ givenByFactionId: 'f1' })).toBe(true)
  })

  it('is false for a quest whose giver never resolved', () => {
    // Load-bearing rather than defensive: givenBy is free text and the
    // fuzzy resolver deliberately returns nothing on an ambiguous match.
    expect(hasQuestGiver({})).toBe(false)
    expect(hasQuestGiver({ givenByNpcId: null, givenByFactionId: null })).toBe(false)
  })
})

// ---------------------------------------------------------------------------

// Args typed as unknown[] so `.mock.calls[0][0]` is reachable — vi.fn with a
// zero-arg implementation infers an empty tuple, which tsc rejects on index
// access even though the test runs fine. (Vitest transpiles rather than
// typechecks, so a green run here does not imply a clean tsc.)
const db = {
  character: {
    findMany: vi.fn() as any,
    update: vi.fn(async (..._a: unknown[]) => ({})),
  },
  factionStanding: {
    findUnique: vi.fn() as any,
    upsert: vi.fn(async (..._a: unknown[]) => ({})),
  },
}

const party = (over: Array<Record<string, unknown>> = []) =>
  over.length ? over : [
    { id: 'c1', name: 'Jason', relationships: null },
    { id: 'c2', name: 'Mira', relationships: null },
  ]

beforeEach(() => {
  vi.clearAllMocks()
  db.character.findMany.mockResolvedValue(party())
  db.factionStanding.findUnique.mockResolvedValue({ value: 1 })
})

describe('applyQuestFailureCost', () => {
  it('charges nothing at all when nobody commissioned the quest', async () => {
    // Charging a best guess would land real consequences on an innocent
    // faction — the failure resolveQuestGiver's ambiguity rule exists to
    // avoid, one system downstream.
    const log = await applyQuestFailureCost(db as never, 'camp1', { name: 'q' }, 'ABANDONED')

    expect(log).toEqual([])
    expect(db.character.findMany).not.toHaveBeenCalled()
    expect(db.factionStanding.upsert).not.toHaveBeenCalled()
  })

  it('charges the whole party, because the party took the job', async () => {
    // Standing and relationships are per-character; a Quest is
    // campaign-level with no participant link.
    await applyQuestFailureCost(db as never, 'camp1', { name: 'q', givenByFactionId: 'f1' }, 'ABANDONED')

    expect(db.factionStanding.upsert).toHaveBeenCalledTimes(2)
    const ids = db.factionStanding.upsert.mock.calls.map((c: any) => c[0].where.characterId_factionId.characterId)
    expect(ids.sort()).toEqual(['c1', 'c2'])
  })

  it('moves faction standing down by one for a walk-away', async () => {
    await applyQuestFailureCost(db as never, 'camp1', { name: 'q', givenByFactionId: 'f1' }, 'ABANDONED')
    expect((db.factionStanding.upsert.mock.calls[0] as any[])[0].update).toEqual({ value: 0 })
  })

  it('leaves faction standing alone for an honest failure', async () => {
    await applyQuestFailureCost(db as never, 'camp1', { name: 'q', givenByFactionId: 'f1' }, 'FAILED')
    expect(db.factionStanding.upsert).not.toHaveBeenCalled()
  })

  it('never drives standing below the bottom of the track', async () => {
    db.factionStanding.findUnique.mockResolvedValue({ value: -3 })
    await applyQuestFailureCost(db as never, 'camp1', { name: 'q', givenByFactionId: 'f1' }, 'ABANDONED')
    // Already at the floor: nothing to write, so no pointless update.
    expect(db.factionStanding.upsert).not.toHaveBeenCalled()
  })

  it('starts from neutral for a character with no standing on record', async () => {
    db.factionStanding.findUnique.mockResolvedValue(null)
    await applyQuestFailureCost(db as never, 'camp1', { name: 'q', givenByFactionId: 'f1' }, 'ABANDONED')
    expect((db.factionStanding.upsert.mock.calls[0] as any[])[0].update).toEqual({ value: -1 })
  })

  it('costs rapport with the NPC who actually asked', async () => {
    db.character.findMany.mockResolvedValue([
      { id: 'c1', name: 'Jason', relationships: { npc1: { trust: 60, respect: 40, tension: 0, fear: 0 } } },
    ])

    await applyQuestFailureCost(db as never, 'camp1', { name: 'q', givenByNpcId: 'npc1' }, 'ABANDONED')

    const written = (db.character.update.mock.calls[0] as any[])[0].data.relationships.npc1
    expect(written.trust).toBe(35)   // 60 - 25
    expect(written.respect).toBe(30) // 40 - 10
  })

  it('leaves trust intact with an NPC when the party merely lost', async () => {
    db.character.findMany.mockResolvedValue([
      { id: 'c1', name: 'Jason', relationships: { npc1: { trust: 60, respect: 40, tension: 0, fear: 0 } } },
    ])

    await applyQuestFailureCost(db as never, 'camp1', { name: 'q', givenByNpcId: 'npc1' }, 'FAILED')

    const written = (db.character.update.mock.calls[0] as any[])[0].data.relationships.npc1
    expect(written.trust).toBe(60)
    expect(written.respect).toBe(25) // 40 - 15
  })

  it('does not disturb rapport with anyone else', async () => {
    db.character.findMany.mockResolvedValue([
      { id: 'c1', name: 'Jason', relationships: {
        npc1: { trust: 50, respect: 50, tension: 0, fear: 0 },
        npc2: { trust: 90, respect: 90, tension: 10, fear: 0 },
      } },
    ])

    await applyQuestFailureCost(db as never, 'camp1', { name: 'q', givenByNpcId: 'npc1' }, 'ABANDONED')

    const written = (db.character.update.mock.calls[0] as any[])[0].data.relationships
    expect(written.npc2).toEqual({ trust: 90, respect: 90, tension: 10, fear: 0 })
  })

  it('preserves the meters it has no opinion about', async () => {
    // tension and fear are written by other systems; a quest failing is
    // not a reason to reset them.
    db.character.findMany.mockResolvedValue([
      { id: 'c1', name: 'Jason', relationships: { npc1: { trust: 50, respect: 50, tension: 30, fear: 20 } } },
    ])

    await applyQuestFailureCost(db as never, 'camp1', { name: 'q', givenByNpcId: 'npc1' }, 'ABANDONED')

    const written = (db.character.update.mock.calls[0] as any[])[0].data.relationships.npc1
    expect(written.tension).toBe(30)
    expect(written.fear).toBe(20)
  })

  it('starts a first-meeting rapport from zero rather than crashing', async () => {
    await applyQuestFailureCost(db as never, 'camp1', { name: 'q', givenByNpcId: 'npc1' }, 'ABANDONED')
    const written = (db.character.update.mock.calls[0] as any[])[0].data.relationships.npc1
    expect(written.trust).toBe(ABANDON_TRUST_DELTA)
  })

  it('clamps rapport at the bottom of the meter', async () => {
    db.character.findMany.mockResolvedValue([
      { id: 'c1', name: 'Jason', relationships: { npc1: { trust: -95, respect: 0, tension: 0, fear: 0 } } },
    ])

    await applyQuestFailureCost(db as never, 'camp1', { name: 'q', givenByNpcId: 'npc1' }, 'ABANDONED')

    expect((db.character.update.mock.calls[0] as any[])[0].data.relationships.npc1.trust).toBe(-100)
  })

  it('is a no-op for a campaign with no living characters', async () => {
    db.character.findMany.mockResolvedValue([])
    const log = await applyQuestFailureCost(db as never, 'camp1', { name: 'q', givenByFactionId: 'f1' }, 'ABANDONED')
    expect(log).toEqual([])
    expect(db.factionStanding.upsert).not.toHaveBeenCalled()
  })

  it('reports what it did, for the resolution log', async () => {
    const log = await applyQuestFailureCost(db as never, 'camp1', { name: 'The Ledger Job', givenByFactionId: 'f1' }, 'ABANDONED')
    expect(log).toHaveLength(2)
    expect(log[0]).toContain('The Ledger Job')
  })
})
