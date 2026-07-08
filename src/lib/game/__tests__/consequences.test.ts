import { describe, it, expect } from 'vitest'
import { applyNpcConsequence, applyFactionConsequence, shouldEscalateImportance } from '../consequences'
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
