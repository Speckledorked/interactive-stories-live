import { describe, it, expect } from 'vitest'
import { factionHasOneLivingLeader, repairFactionLeadership } from '../checks/factionLeadership'
import { emptySnapshot } from './testHelpers'
import { Violation } from '../types'

function npc(overrides: Record<string, any>) {
  return { id: 'npc-x', name: 'X', isAlive: true, factionId: 'f1', factionRole: null, importance: 1, socialTies: null, ...overrides }
}

describe('factionHasOneLivingLeader', () => {
  it('flags an active faction with living members but no living LEADER', () => {
    const snapshot = emptySnapshot({
      factions: [{ id: 'f1', name: 'The Crown', isActive: true, leaderCharacterId: null, relationships: {} }],
      npcs: [npc({ id: 'npc1', name: 'Kessler', importance: 3 })],
    })
    const violations = factionHasOneLivingLeader.run(snapshot)
    expect(violations).toHaveLength(1)
    expect(violations[0].entityType).toBe('FACTION')
  })

  it('does not flag a faction that already has a living leader', () => {
    const snapshot = emptySnapshot({
      factions: [{ id: 'f1', name: 'The Crown', isActive: true, leaderCharacterId: null, relationships: {} }],
      npcs: [npc({ id: 'npc1', name: 'Kessler', factionRole: 'LEADER' })],
    })
    expect(factionHasOneLivingLeader.run(snapshot)).toHaveLength(0)
  })

  it('does not flag an inactive (collapsed) faction', () => {
    const snapshot = emptySnapshot({
      factions: [{ id: 'f1', name: 'The Crown', isActive: false, leaderCharacterId: null, relationships: {} }],
      npcs: [npc({ id: 'npc1', name: 'Kessler' })],
    })
    expect(factionHasOneLivingLeader.run(snapshot)).toHaveLength(0)
  })

  it('does not flag a faction with no living members at all', () => {
    const snapshot = emptySnapshot({
      factions: [{ id: 'f1', name: 'The Crown', isActive: true, leaderCharacterId: null, relationships: {} }],
      npcs: [npc({ id: 'npc1', name: 'Kessler', isAlive: false })],
    })
    expect(factionHasOneLivingLeader.run(snapshot)).toHaveLength(0)
  })

  it('does not flag a faction led by a player character, even with no NPC LEADER', () => {
    const snapshot = emptySnapshot({
      factions: [{ id: 'f1', name: 'The Crown', isActive: true, leaderCharacterId: 'char1', relationships: {} }],
      npcs: [npc({ id: 'npc1', name: 'Kessler' })],
    })
    expect(factionHasOneLivingLeader.run(snapshot)).toHaveLength(0)
  })

  describe('Phase 4 — faction.leaderOptional worldRule', () => {
    const leaderlessSnapshot = (worldRules: any) =>
      emptySnapshot({
        turnNumber: 100,
        factions: [{ id: 'f1', name: 'The Free Assembly', isActive: true, leaderCharacterId: null, relationships: {} }],
        npcs: [npc({ id: 'npc1', name: 'Kessler', importance: 3 })],
        worldRules,
      })

    it('still flags a leaderless faction when there is no rule on record', () => {
      expect(factionHasOneLivingLeader.run(leaderlessSnapshot(null))).toHaveLength(1)
    })

    it('does not flag a leaderless faction once an active, confident, past-probation rule says leaders are optional', () => {
      const snapshot = leaderlessSnapshot({
        rules: [{ familyKey: 'faction.leaderOptional', applies: true, confidence: 0.9, rationale: 'x', sinceTurn: 0 }],
      })
      expect(factionHasOneLivingLeader.run(snapshot)).toHaveLength(0)
    })

    it('still flags it when the rule exists but says leaders are required (applies: false)', () => {
      const snapshot = leaderlessSnapshot({
        rules: [{ familyKey: 'faction.leaderOptional', applies: false, confidence: 0.9, rationale: 'x', sinceTurn: 0 }],
      })
      expect(factionHasOneLivingLeader.run(snapshot)).toHaveLength(1)
    })

    it('still flags it when the rule is too low-confidence to trust', () => {
      const snapshot = leaderlessSnapshot({
        rules: [{ familyKey: 'faction.leaderOptional', applies: true, confidence: 0.2, rationale: 'x', sinceTurn: 0 }],
      })
      expect(factionHasOneLivingLeader.run(snapshot)).toHaveLength(1)
    })

    it('still flags it while the rule is within its probation window', () => {
      const snapshot = leaderlessSnapshot({
        rules: [{ familyKey: 'faction.leaderOptional', applies: true, confidence: 0.9, rationale: 'x', sinceTurn: 99 }],
      })
      expect(factionHasOneLivingLeader.run(snapshot)).toHaveLength(1)
    })
  })
})

describe('repairFactionLeadership', () => {
  it('promotes the most important living member', () => {
    const snapshot = emptySnapshot({
      factions: [{ id: 'f1', name: 'The Crown', isActive: true, leaderCharacterId: null, relationships: {} }],
      npcs: [
        npc({ id: 'npc1', name: 'Kessler', importance: 2 }),
        npc({ id: 'npc2', name: 'Vashti', importance: 5 }),
      ],
    })
    const violation: Violation = {
      checkKey: 'faction.leadership.exactlyOneLivingLeader',
      entityType: 'FACTION', entityId: 'f1', entityName: 'The Crown', description: 'x',
    }
    const repair = repairFactionLeadership(violation, snapshot)

    // Reported as the NPC's role changing (matching leadershipTick.ts's own
    // WorldChange for this decision), not the faction.
    expect(repair?.entityType).toBe('NPC')
    expect(repair?.entityId).toBe('npc2')
    expect(repair?.write).toEqual({ model: 'nPC', id: 'npc2', data: { factionRole: 'LEADER' } })
  })

  it('returns null when the faction no longer exists in the snapshot', () => {
    const violation: Violation = {
      checkKey: 'faction.leadership.exactlyOneLivingLeader',
      entityType: 'FACTION', entityId: 'missing', entityName: 'Gone', description: 'x',
    }
    expect(repairFactionLeadership(violation, emptySnapshot())).toBeNull()
  })
})
