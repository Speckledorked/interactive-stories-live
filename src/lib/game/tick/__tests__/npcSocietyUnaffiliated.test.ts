// src/lib/game/tick/__tests__/npcSocietyUnaffiliated.test.ts
// Phase 9 NPC society follow-up: ties between NPCs with no faction
// affiliation, derived from shared "home turf" instead.

import { describe, it, expect } from 'vitest'
import { deriveHomeLocation, decideUnaffiliatedTie } from '../npcSocietyTick'

describe('deriveHomeLocation', () => {
  it('is deterministic for the same npc id and location list', () => {
    const locations = ['Harborview', 'Old Town', 'The Sprawl']
    expect(deriveHomeLocation('npc-1', locations)).toBe(deriveHomeLocation('npc-1', locations))
  })

  it('returns null when there are no discovered locations', () => {
    expect(deriveHomeLocation('npc-1', [])).toBeNull()
  })

  it('picks a location actually in the list', () => {
    const locations = ['Harborview', 'Old Town', 'The Sprawl']
    const home = deriveHomeLocation('npc-1', locations)
    expect(locations).toContain(home)
  })
})

describe('decideUnaffiliatedTie', () => {
  it('is NEUTRAL when homes differ', () => {
    expect(decideUnaffiliatedTie({ threat: null }, { threat: null }, false)).toBe('NEUTRAL')
  })

  it('is ALLY when neither is a PbtA-style threat and they share turf', () => {
    expect(decideUnaffiliatedTie({ threat: null }, { threat: '' }, true)).toBe('ALLY')
  })

  it('is RIVAL when both are threats sharing turf — predators competing for the same ground', () => {
    expect(decideUnaffiliatedTie({ threat: 'warlord' }, { threat: 'grotesque' }, true)).toBe('RIVAL')
  })

  it('is NEUTRAL when only one side is a threat — no clean signal', () => {
    expect(decideUnaffiliatedTie({ threat: 'warlord' }, { threat: null }, true)).toBe('NEUTRAL')
  })
})
