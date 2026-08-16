import { describe, it, expect } from 'vitest'
import {
  repairWarContestedLocation,
  repairClockParticipants,
  repairCharacterRelationships,
  repairCharacterReputation,
  repairDebtCounterparty,
} from '../repairs/referentialIntegrity'
import { emptySnapshot } from './testHelpers'
import { Violation } from '../types'

function violation(overrides: Partial<Violation> = {}): Violation {
  return {
    checkKey: 'test.check',
    entityType: 'NPC',
    entityId: 'e1',
    entityName: 'Test Entity',
    description: 'test',
    ...overrides,
  }
}

describe('repairWarContestedLocation', () => {
  it('nulls out the dangling contestedLocationId', () => {
    const repair = repairWarContestedLocation(violation({ entityType: 'WAR', entityId: 'war1', entityName: 'The Siege' }), emptySnapshot())
    expect(repair?.write).toEqual({ model: 'war', id: 'war1', data: { contestedLocationId: null } })
  })
})

describe('repairClockParticipants', () => {
  it('drops only the ids that no longer resolve', () => {
    const snapshot = emptySnapshot({
      npcs: [{ id: 'npc1', name: 'Kessler', isAlive: true, factionId: null, factionRole: null, importance: 1 }],
      clocks: [{ id: 'clock1', name: 'Scheme', resolvedAt: null, sourceFactionId: null, participantNpcIds: ['npc1', 'gone'] }],
    })
    const repair = repairClockParticipants(violation({ entityType: 'CLOCK', entityId: 'clock1', entityName: 'Scheme' }), snapshot)
    expect(repair?.write).toEqual({ model: 'clock', id: 'clock1', data: { participantNpcIds: ['npc1'] } })
  })

  it('returns null when the clock no longer exists in the snapshot', () => {
    const repair = repairClockParticipants(violation({ entityType: 'CLOCK', entityId: 'missing' }), emptySnapshot())
    expect(repair).toBeNull()
  })
})

describe('repairCharacterRelationships — recovery, not just cleanup', () => {
  it('drops an orphan key with no name match', () => {
    const snapshot = emptySnapshot({
      npcs: [{ id: 'npc1', name: 'Lord Kessler', isAlive: true, factionId: null, factionRole: null, importance: 1 }],
      characters: [{
        id: 'char1', name: 'Jason',
        relationships: { npc1: { trust: 10 }, 'npc_123': { trust: 5, tension: 0, respect: 0, fear: 0 } },
        resources: null,
      }],
    })
    const repair = repairCharacterRelationships(violation({ entityType: 'CHARACTER', entityId: 'char1', entityName: 'Jason' }), snapshot)
    expect(repair?.write).toEqual({
      model: 'character', id: 'char1',
      data: { relationships: { npc1: { trust: 10 } } },
    })
  })

  it('re-keys to the real NPC id when the orphan key IS that NPC\'s exact name', () => {
    const snapshot = emptySnapshot({
      npcs: [{ id: 'npc1', name: 'Lord Kessler', isAlive: true, factionId: null, factionRole: null, importance: 1 }],
      characters: [{
        id: 'char1', name: 'Jason',
        relationships: { 'Lord Kessler': { trust: 10, tension: 0, respect: 0, fear: 0 } },
        resources: null,
      }],
    })
    const repair = repairCharacterRelationships(violation({ entityType: 'CHARACTER', entityId: 'char1', entityName: 'Jason' }), snapshot)
    // The trust value is PRESERVED under the real id — this is the recovery
    // case, not a prune: real relationship history that no roll could see
    // becomes visible again instead of being deleted.
    expect(repair?.write).toEqual({
      model: 'character', id: 'char1',
      data: { relationships: { npc1: { trust: 10, tension: 0, respect: 0, fear: 0 } } },
    })
  })

  it('returns null when there is nothing to repair', () => {
    const snapshot = emptySnapshot({
      npcs: [{ id: 'npc1', name: 'Lord Kessler', isAlive: true, factionId: null, factionRole: null, importance: 1 }],
      characters: [{ id: 'char1', name: 'Jason', relationships: null, resources: null }],
    })
    const repair = repairCharacterRelationships(violation({ entityType: 'CHARACTER', entityId: 'char1' }), snapshot)
    expect(repair).toBeNull()
  })
})

// #373: repairNpcSocialTies and repairFactionRelationships used to be
// tested here. Both are gone — ties are FK'd edge rows, so an orphan
// endpoint cannot exist at rest and there is nothing left to repair. The
// CHECKS survive as regression guards (see referentialIntegrity.test.ts);
// the registry deliberately has no entry for either key, which
// checkSeverity.test.ts and escalationSourceMap.test.ts both assert.

describe('repairCharacterReputation', () => {
  it('drops the orphan faction key but keeps the rest of resources intact', () => {
    const snapshot = emptySnapshot({
      factions: [{ id: 'f1', name: 'The Crown', isActive: true, leaderCharacterId: null }],
      characters: [{
        id: 'char1', name: 'Jason', relationships: null,
        resources: { gold: 50, reputation: { f1: 10, 'f-gone': -5 } },
      }],
    })
    const repair = repairCharacterReputation(violation({ entityType: 'CHARACTER', entityId: 'char1', entityName: 'Jason' }), snapshot)
    expect(repair?.write).toEqual({
      model: 'character', id: 'char1',
      data: { resources: { gold: 50, reputation: { f1: 10 } } },
    })
  })
})

describe('repairDebtCounterparty', () => {
  it('nulls out counterpartyId while the write leaves counterpartyName untouched', () => {
    const repair = repairDebtCounterparty(violation({ entityType: 'DEBT', entityId: 'debt1', entityName: 'Vashti' }), emptySnapshot())
    expect(repair?.write).toEqual({ model: 'debt', id: 'debt1', data: { counterpartyId: null } })
  })
})
