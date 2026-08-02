import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    nPC: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    faction: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  },
}))

import { prisma } from '@/lib/prisma'
import { applyNpcConsequence, applyFactionConsequence, applyConsequences, shouldEscalateImportance } from '../consequences'
import type { ExtractedConsequence } from '@/lib/ai/consequenceExtraction'
import type { NPC, Faction } from '@prisma/client'

function makeNpc(overrides: Partial<NPC> = {}): NPC {
  return {
    id: 'npc-1',
    campaignId: 'campaign-1',
    name: 'Grik',
    pronouns: null,
    description: null,
    currentLocation: null,
    goals: 'survive the winter',
    relationship: null,
    isAlive: true,
    importance: 1,
    gmNotes: null,
    threat: null,
    impulses: [],
    moves: [],
    currentPlan: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as NPC
}

function makeFaction(overrides: Partial<Faction> = {}): Faction {
  return {
    id: 'faction-1',
    campaignId: 'campaign-1',
    name: 'The Rustwatch',
    description: null,
    goals: null,
    resources: 50,
    influence: 50,
    currentPlan: null,
    threatLevel: 1,
    relationships: null,
    gmNotes: null,
    stability: 50,
    military: 50,
    goal: 'CONSOLIDATE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Faction
}

function makeConsequence(overrides: Partial<ExtractedConsequence> = {}): ExtractedConsequence {
  return {
    entityType: 'NPC',
    entityName: 'Grik',
    action: 'SPARED',
    reason: 'The party let Grik go after he begged for mercy.',
    intensity: 'moderate',
    ...overrides,
  }
}

describe('shouldEscalateImportance', () => {
  it('always escalates KILLED/BETRAYED/RECRUITED regardless of intensity', () => {
    expect(shouldEscalateImportance('KILLED', 'minor', 1)).toBe(true)
    expect(shouldEscalateImportance('BETRAYED', 'minor', 1)).toBe(true)
    expect(shouldEscalateImportance('RECRUITED', 'minor', 1)).toBe(true)
  })

  it('does not escalate routine actions unless intensity is major', () => {
    expect(shouldEscalateImportance('SPARED', 'minor', 1)).toBe(false)
    expect(shouldEscalateImportance('SPARED', 'moderate', 1)).toBe(false)
    expect(shouldEscalateImportance('SPARED', 'major', 1)).toBe(true)
  })

  it('never escalates an NPC already at or above the major threshold', () => {
    expect(shouldEscalateImportance('KILLED', 'major', 4)).toBe(false)
    expect(shouldEscalateImportance('KILLED', 'major', 5)).toBe(false)
  })
})

describe('applyNpcConsequence', () => {
  it('graduates a minor NPC to major importance on a defining action', () => {
    const npc = makeNpc({ importance: 1 })
    const { updateData, changes } = applyNpcConsequence(npc, makeConsequence({ action: 'RECRUITED', intensity: 'minor' }))
    expect(updateData.importance).toBe(4)
    expect(changes.some(c => c.field === 'importance' && c.newValue === 4)).toBe(true)
  })

  it('does not touch importance for a minor-intensity routine action', () => {
    const npc = makeNpc({ importance: 1 })
    const { updateData } = applyNpcConsequence(npc, makeConsequence({ action: 'SPARED', intensity: 'minor' }))
    expect(updateData.importance).toBeUndefined()
  })

  it('applies updated goal and relationship text when provided', () => {
    const npc = makeNpc({ goals: 'old goal', relationship: 'stranger' })
    const { updateData } = applyNpcConsequence(npc, makeConsequence({
      updatedGoal: 'seek revenge on the party',
      updatedRelationship: 'sworn enemy',
    }))
    expect(updateData.goals).toBe('seek revenge on the party')
    expect(updateData.relationship).toBe('sworn enemy')
  })

  it('still records a change even when nothing else changed, so the event is retrievable', () => {
    const npc = makeNpc({ importance: 5 }) // already major, no escalation possible
    const { updateData, changes } = applyNpcConsequence(npc, makeConsequence({ intensity: 'minor' }))
    expect(Object.keys(updateData).length).toBe(0)
    expect(changes).toHaveLength(1)
    expect(changes[0].field).toBe('consequence')
  })

  it('marks every consequence-origin change with origin "consequence"', () => {
    const npc = makeNpc()
    const { changes } = applyNpcConsequence(npc, makeConsequence({ updatedGoal: 'new goal' }))
    expect(changes.every(c => c.origin === 'consequence')).toBe(true)
  })
})

describe('applyFactionConsequence', () => {
  it('applies deterministic, action-specific deltas', () => {
    const faction = makeFaction({ resources: 50, stability: 50, military: 50 })
    const { updateData } = applyFactionConsequence(faction, makeConsequence({
      entityType: 'FACTION', entityName: 'The Rustwatch', action: 'SABOTAGED', intensity: 'moderate',
    }))
    expect(updateData.resources).toBe(47) // 50 - 3
    expect(updateData.stability).toBe(48) // 50 - 2
    expect(updateData.military).toBe(48)  // 50 - 2
  })

  it('scales deltas by intensity', () => {
    const faction = makeFaction({ resources: 50 })
    const minor = applyFactionConsequence(faction, makeConsequence({ entityType: 'FACTION', action: 'FAVORED', intensity: 'minor' }))
    const major = applyFactionConsequence(faction, makeConsequence({ entityType: 'FACTION', action: 'FAVORED', intensity: 'major' }))
    expect(minor.updateData.resources).toBeLessThan(major.updateData.resources)
  })

  it('clamps to 0-100', () => {
    const faction = makeFaction({ resources: 1, stability: 1, military: 99 })
    const { updateData } = applyFactionConsequence(faction, makeConsequence({ entityType: 'FACTION', action: 'SABOTAGED', intensity: 'major' }))
    expect(updateData.resources).toBeGreaterThanOrEqual(0)
    expect(updateData.stability).toBeGreaterThanOrEqual(0)
    expect(updateData.military).toBeLessThanOrEqual(100)
  })

  it('applies an updated faction goal when provided', () => {
    const faction = makeFaction({ goal: 'CONSOLIDATE' })
    const { updateData } = applyFactionConsequence(faction, makeConsequence({
      entityType: 'FACTION', action: 'BETRAYED', updatedFactionGoal: 'DESTABILIZE_RIVAL',
    }))
    expect(updateData.goal).toBe('DESTABILIZE_RIVAL')
  })
})

describe('applyConsequences', () => {
  const db = prisma as any

  beforeEach(() => {
    vi.clearAllMocks()
    db.faction.findMany.mockResolvedValue([])
  })

  it('resolves an NPC by exact name and applies the consequence', async () => {
    db.nPC.findMany.mockResolvedValue([makeNpc({ id: 'npc-1', name: 'Grik', importance: 1 })])

    // RECRUITED always escalates importance (see ALWAYS_ESCALATE_ACTIONS),
    // so a successful resolution is guaranteed to produce a real DB write —
    // SPARED/moderate on a fresh NPC can legitimately produce an empty
    // updateData (see applyNpcConsequence's own tests above), which would
    // make this assertion meaningless either way.
    const changes = await applyConsequences('campaign-1', [makeConsequence({ entityName: 'Grik', action: 'RECRUITED' })])

    expect(db.nPC.update).toHaveBeenCalledTimes(1)
    expect(changes.length).toBeGreaterThan(0)
  })

  it('does NOT cross-match an entity whose name is a substring of another — the actual bug this guards against', async () => {
    // The exact failure mode reported: "Bob" must never match "Bobby's Assistant".
    db.nPC.findMany.mockResolvedValue([makeNpc({ id: 'npc-1', name: "Bobby's Assistant" })])

    const changes = await applyConsequences('campaign-1', [makeConsequence({ entityName: 'Bob' })])

    expect(db.nPC.update).not.toHaveBeenCalled()
    expect(changes).toEqual([])
  })

  it('resolves a close typo/case variant via confident fuzzy matching — proves the fallback is no longer dead code', async () => {
    // Before the fix, `findFirst(equals) ?? findFirst(contains)` always
    // evaluated to the first (unresolved) promise — the fallback branch
    // never ran regardless of whether the exact match resolved to null.
    db.nPC.findMany.mockResolvedValue([makeNpc({ id: 'npc-1', name: 'Kessler', importance: 1 })])

    const changes = await applyConsequences('campaign-1', [makeConsequence({ entityName: 'Kesler', action: 'RECRUITED' })])

    expect(db.nPC.update).toHaveBeenCalledTimes(1)
    expect(changes.length).toBeGreaterThan(0)
  })

  it('skips (does not guess) when a name fuzzy-matches more than one NPC', async () => {
    db.nPC.findMany.mockResolvedValue([
      makeNpc({ id: 'npc-1', name: 'Kessler' }),
      makeNpc({ id: 'npc-2', name: 'Kestler' }),
    ])

    const changes = await applyConsequences('campaign-1', [makeConsequence({ entityName: 'Kesler' })])

    expect(db.nPC.update).not.toHaveBeenCalled()
    expect(changes).toEqual([])
  })

  it('skips when no NPC matches at all', async () => {
    db.nPC.findMany.mockResolvedValue([makeNpc({ id: 'npc-1', name: 'Grik' })])

    const changes = await applyConsequences('campaign-1', [makeConsequence({ entityName: 'Someone Else Entirely' })])

    expect(db.nPC.update).not.toHaveBeenCalled()
    expect(changes).toEqual([])
  })

  it('resolves factions the same way, fetched once for the whole batch', async () => {
    db.nPC.findMany.mockResolvedValue([])
    db.faction.findMany.mockResolvedValue([makeFaction({ id: 'faction-1', name: 'The Rustwatch' })])

    await applyConsequences('campaign-1', [
      makeConsequence({ entityType: 'FACTION', entityName: 'The Rustwatch', action: 'SABOTAGED' }),
    ])

    expect(db.faction.findMany).toHaveBeenCalledTimes(1)
    expect(db.faction.update).toHaveBeenCalledTimes(1)
  })

  it('a second consequence in the same batch touching the same entity computes its delta from the just-written value, not stale pre-batch state', async () => {
    db.nPC.findMany.mockResolvedValue([])
    db.faction.findMany.mockResolvedValue([makeFaction({ id: 'faction-1', name: 'The Rustwatch', resources: 50 })])

    await applyConsequences('campaign-1', [
      makeConsequence({ entityType: 'FACTION', entityName: 'The Rustwatch', action: 'FAVORED', intensity: 'moderate' }), // +3
      makeConsequence({ entityType: 'FACTION', entityName: 'The Rustwatch', action: 'FAVORED', intensity: 'moderate' }), // +3 again, on top of the first
    ])

    expect(db.faction.update).toHaveBeenCalledTimes(2)
    const firstCall = db.faction.update.mock.calls[0][0]
    const secondCall = db.faction.update.mock.calls[1][0]
    expect(firstCall.data.resources).toBe(53) // 50 + 3
    expect(secondCall.data.resources).toBe(56) // 53 + 3, not 50 + 3 again
  })
})
