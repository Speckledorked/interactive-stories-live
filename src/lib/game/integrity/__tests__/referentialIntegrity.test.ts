import { describe, it, expect } from 'vitest'
import {
  warContestedLocationResolves,
  clockParticipantNpcsResolve,
  characterRelationshipKeysResolve,
  npcSocialTiesKeysResolve,
  factionRelationshipKeysResolve,
  characterReputationKeysResolve,
  debtCounterpartyResolves,
  clockSourceFactionActive,
} from '../checks/referentialIntegrity'
import { emptySnapshot } from './testHelpers'

describe('warContestedLocationResolves', () => {
  it('flags a war contesting a Location that no longer exists', () => {
    const snapshot = emptySnapshot({
      locationIds: new Set(['loc-real']),
      wars: [{ id: 'war1', name: 'The Siege', status: 'ESCALATING', contestedLocationId: 'loc-gone' }],
    })
    const violations = warContestedLocationResolves.run(snapshot)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ entityType: 'WAR', entityId: 'war1' })
  })

  it('does not flag a war whose location exists, or one with none', () => {
    const snapshot = emptySnapshot({
      locationIds: new Set(['loc-real']),
      wars: [
        { id: 'war1', name: 'A', status: 'ESCALATING', contestedLocationId: 'loc-real' },
        { id: 'war2', name: 'B', status: 'ESCALATING', contestedLocationId: null },
      ],
    })
    expect(warContestedLocationResolves.run(snapshot)).toHaveLength(0)
  })
})

describe('clockParticipantNpcsResolve', () => {
  it('flags a clock whose participant list includes a deleted NPC', () => {
    const snapshot = emptySnapshot({
      npcs: [{ id: 'npc1', name: 'Kessler', isAlive: true, factionId: null, factionRole: null, importance: 1 }],
      clocks: [{ id: 'clock1', name: 'Joint Scheme', resolvedAt: null, sourceFactionId: null, participantNpcIds: ['npc1', 'npc-gone'] }],
    })
    const violations = clockParticipantNpcsResolve.run(snapshot)
    expect(violations).toHaveLength(1)
    expect(violations[0].entityType).toBe('CLOCK')
  })

  it('does not flag a clock whose participants all resolve', () => {
    const snapshot = emptySnapshot({
      npcs: [{ id: 'npc1', name: 'Kessler', isAlive: true, factionId: null, factionRole: null, importance: 1 }],
      clocks: [{ id: 'clock1', name: 'Joint Scheme', resolvedAt: null, sourceFactionId: null, participantNpcIds: ['npc1'] }],
    })
    expect(clockParticipantNpcsResolve.run(snapshot)).toHaveLength(0)
  })
})

describe('characterRelationshipKeysResolve', () => {
  it('flags an orphan key in Character.relationships', () => {
    const snapshot = emptySnapshot({
      npcs: [{ id: 'npc1', name: 'Kessler', isAlive: true, factionId: null, factionRole: null, importance: 1 }],
      characters: [{
        id: 'char1', name: 'Jason',
        relationships: { npc1: { trust: 10 }, 'npc_123': { trust: 5 } },
        resources: null,
      }],
    })
    const violations = characterRelationshipKeysResolve.run(snapshot)
    expect(violations).toHaveLength(1)
    expect(violations[0].description).toContain('npc_123')
  })

  it('does not flag when every key resolves, or relationships is null', () => {
    const withValid = emptySnapshot({
      npcs: [{ id: 'npc1', name: 'Kessler', isAlive: true, factionId: null, factionRole: null, importance: 1 }],
      characters: [{ id: 'char1', name: 'Jason', relationships: null, resources: null }],
    })
    expect(characterRelationshipKeysResolve.run(withValid)).toHaveLength(0)

    const withNull = emptySnapshot({
      characters: [{ id: 'char1', name: 'Jason', relationships: null, resources: null }],
    })
    expect(characterRelationshipKeysResolve.run(withNull)).toHaveLength(0)
  })
})

describe('npcSocialTiesKeysResolve (#373 regression guard)', () => {
  // The FK on NpcTie makes this unreachable at rest — the check exists so
  // that dropping the constraint in some future migration surfaces here
  // rather than as a reader naming a ghost mid-tick. Same posture as
  // warContestedLocationResolves.
  it('flags an edge whose endpoint no longer exists', () => {
    const npc1 = { id: 'npc1', name: 'Kessler', isAlive: true, factionId: null, factionRole: null, importance: 1 }
    const npc2 = { id: 'npc2', name: 'Vashti', isAlive: true, factionId: null, factionRole: null, importance: 1 }
    const snapshot = emptySnapshot({
      npcs: [npc1, npc2],
      npcTies: [
        { aId: 'npc1', bId: 'npc2', type: 'RIVAL', since: 1 },
        { aId: 'npc1', bId: 'zgone', type: 'ALLY', since: 1 },
      ],
    })
    const violations = npcSocialTiesKeysResolve.run(snapshot)
    expect(violations).toHaveLength(1)
    // Attributed to the endpoint that still exists, so an admin has
    // something they can actually open.
    expect(violations[0].entityId).toBe('npc1')
    expect(violations[0].description).toContain('zgone')
  })

  it('flags nothing when every endpoint resolves', () => {
    const snapshot = emptySnapshot({
      npcs: [
        { id: 'npc1', name: 'Kessler', isAlive: true, factionId: null, factionRole: null, importance: 1 },
        { id: 'npc2', name: 'Vashti', isAlive: true, factionId: null, factionRole: null, importance: 1 },
      ],
      npcTies: [{ aId: 'npc1', bId: 'npc2', type: 'ALLY', since: 1 }],
    })
    expect(npcSocialTiesKeysResolve.run(snapshot)).toHaveLength(0)
  })
})

describe('factionRelationshipKeysResolve (#373 regression guard)', () => {
  it('flags an edge referencing a collapsed-and-deleted faction', () => {
    const f1 = { id: 'f1', name: 'The Crown', isActive: true, leaderCharacterId: null }
    const snapshot = emptySnapshot({
      factions: [f1],
      factionTies: [{ aId: 'f1', bId: 'zgone', type: 'RIVAL', since: 1 }],
    })
    const violations = factionRelationshipKeysResolve.run(snapshot)
    expect(violations).toHaveLength(1)
    expect(violations[0].entityType).toBe('FACTION')
    expect(violations[0].entityId).toBe('f1')
  })
})

describe('characterReputationKeysResolve', () => {
  it('flags an orphan faction id inside resources.reputation', () => {
    const snapshot = emptySnapshot({
      factions: [{ id: 'f1', name: 'The Crown', isActive: true, leaderCharacterId: null }],
      characters: [{ id: 'char1', name: 'Jason', relationships: null, resources: { gold: 0, reputation: { f1: 10, 'f-gone': -5 } } }],
    })
    const violations = characterReputationKeysResolve.run(snapshot)
    expect(violations).toHaveLength(1)
    expect(violations[0].description).toContain('f-gone')
  })

  it('does not throw when resources has no reputation field at all', () => {
    const snapshot = emptySnapshot({
      characters: [{ id: 'char1', name: 'Jason', relationships: null, resources: { gold: 0 } }],
    })
    expect(characterReputationKeysResolve.run(snapshot)).toHaveLength(0)
  })
})

describe('debtCounterpartyResolves', () => {
  it('flags a debt whose counterparty id points at nothing', () => {
    const snapshot = emptySnapshot({
      debts: [{ id: 'debt1', counterpartyId: 'npc-gone', counterpartyName: 'Vashti', counterpartyType: 'npc' }],
    })
    const violations = debtCounterpartyResolves.run(snapshot)
    expect(violations).toHaveLength(1)
    expect(violations[0].entityType).toBe('DEBT')
  })

  it('does not flag a debt with no counterparty id set, or one that resolves', () => {
    const snapshot = emptySnapshot({
      npcs: [{ id: 'npc1', name: 'Vashti', isAlive: true, factionId: null, factionRole: null, importance: 1 }],
      debts: [
        { id: 'debt1', counterpartyId: null, counterpartyName: 'Someone', counterpartyType: 'npc' },
        { id: 'debt2', counterpartyId: 'npc1', counterpartyName: 'Vashti', counterpartyType: 'npc' },
      ],
    })
    expect(debtCounterpartyResolves.run(snapshot)).toHaveLength(0)
  })

  it('checks the faction pool when counterpartyType is faction', () => {
    const snapshot = emptySnapshot({
      factions: [{ id: 'f1', name: 'The Crown', isActive: true, leaderCharacterId: null }],
      debts: [{ id: 'debt1', counterpartyId: 'f1', counterpartyName: 'The Crown', counterpartyType: 'faction' }],
    })
    expect(debtCounterpartyResolves.run(snapshot)).toHaveLength(0)
  })
})

describe('clockSourceFactionActive', () => {
  it('flags an unresolved clock still driven by a collapsed faction', () => {
    const snapshot = emptySnapshot({
      factions: [{ id: 'f1', name: 'The Crown', isActive: false, leaderCharacterId: null }],
      clocks: [{ id: 'clock1', name: 'Siege Front', resolvedAt: null, sourceFactionId: 'f1', participantNpcIds: [] }],
    })
    const violations = clockSourceFactionActive.run(snapshot)
    expect(violations).toHaveLength(1)
  })

  it('does not flag a resolved clock, one with no sourceFactionId, or one driven by an active faction', () => {
    const snapshot = emptySnapshot({
      factions: [{ id: 'f1', name: 'The Crown', isActive: true, leaderCharacterId: null }],
      clocks: [
        { id: 'clock1', name: 'A', resolvedAt: new Date(), sourceFactionId: 'f1', participantNpcIds: [] },
        { id: 'clock2', name: 'B', resolvedAt: null, sourceFactionId: null, participantNpcIds: [] },
        { id: 'clock3', name: 'C', resolvedAt: null, sourceFactionId: 'f1', participantNpcIds: [] },
      ],
    })
    expect(clockSourceFactionActive.run(snapshot)).toHaveLength(0)
  })
})
