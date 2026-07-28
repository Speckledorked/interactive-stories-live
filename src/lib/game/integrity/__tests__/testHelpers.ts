// src/lib/game/integrity/__tests__/testHelpers.ts
// Shared snapshot builder for integrity check/repair tests. Every check and
// repair is pure over an IntegritySnapshot, so tests never need mocks — a
// literal object is the entire fixture.

import { IntegritySnapshot } from '../types'

export function emptySnapshot(overrides: Partial<IntegritySnapshot> = {}): IntegritySnapshot {
  return {
    campaignId: 'camp1',
    turnNumber: 5,
    locationIds: new Set(),
    npcs: [],
    factions: [],
    characters: [],
    clocks: [],
    debts: [],
    wars: [],
    quests: [],
    ...overrides,
  }
}
