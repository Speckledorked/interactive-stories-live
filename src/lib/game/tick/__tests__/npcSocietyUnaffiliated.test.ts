// src/lib/game/tick/__tests__/npcSocietyUnaffiliated.test.ts
// Phase 9 NPC society follow-up: ties between NPCs with no faction
// affiliation, derived from shared "home turf" instead.

import { describe, it, expect } from 'vitest'
import {
  deriveHomeLocation,
  decideUnaffiliatedTie,
  sharesTurf,
  MIN_LOCATIONS_FOR_TURF_SIGNAL,
} from '../npcSocietyTick'

const LOCATIONS = ['Harborview', 'Old Town', 'The Sprawl']

describe('deriveHomeLocation', () => {
  it('is deterministic for the same npc id and location list', () => {
    expect(deriveHomeLocation({ id: 'npc-1' }, LOCATIONS)).toEqual(
      deriveHomeLocation({ id: 'npc-1' }, LOCATIONS)
    )
  })

  it('returns null when there are no discovered locations', () => {
    expect(deriveHomeLocation({ id: 'npc-1' }, [])).toBeNull()
  })

  it('picks a location actually in the list', () => {
    expect(LOCATIONS).toContain(deriveHomeLocation({ id: 'npc-1' }, LOCATIONS)!.name)
  })

  it('prefers where the NPC actually is over the hash (#420)', () => {
    // The defect: this file hashed unconditionally while npcTick.ts read
    // currentLocation first, so the two disagreed about where the same NPC
    // lived — and this one disagreed with the database.
    const anchored = deriveHomeLocation({ id: 'npc-1', currentLocation: 'Old Town' }, LOCATIONS)

    expect(anchored).toEqual({ name: 'Old Town', anchored: true })
    // ...and it is a different answer from the hash for at least some ids,
    // which is what made the disagreement observable.
    const hashed = deriveHomeLocation({ id: 'npc-1' }, LOCATIONS)
    expect(hashed!.anchored).toBe(false)
  })

  it('falls back to the hash when the NPC is standing somewhere undiscovered', () => {
    const home = deriveHomeLocation({ id: 'npc-1', currentLocation: 'Nowhere At All' }, LOCATIONS)

    expect(home!.anchored).toBe(false)
    expect(LOCATIONS).toContain(home!.name)
  })
})

describe('sharesTurf (#420)', () => {
  const real = (name: string) => ({ name, anchored: true })
  const hashed = (name: string) => ({ name, anchored: false })

  it('is false when either home is unknown', () => {
    expect(sharesTurf(null, real('Old Town'), 5)).toBe(false)
    expect(sharesTurf(real('Old Town'), null, 5)).toBe(false)
  })

  it('is false when the homes differ', () => {
    expect(sharesTurf(real('Old Town'), real('Harborview'), 5)).toBe(false)
  })

  it('trusts two real locations however small the map is', () => {
    // Standing in the same place is a fact, not a coincidence.
    expect(sharesTurf(real('Old Town'), real('Old Town'), 1)).toBe(true)
  })

  it('refuses a hash coincidence over too few locations', () => {
    // This is the finding: with one location every unaffiliated pair
    // "shares turf", so every one of them formed an ALLY or RIVAL tie on
    // the strength of `x % 1 === 0`.
    const tooFew = MIN_LOCATIONS_FOR_TURF_SIGNAL - 1
    expect(sharesTurf(hashed('Old Town'), hashed('Old Town'), tooFew)).toBe(false)
    expect(sharesTurf(hashed('Old Town'), real('Old Town'), tooFew)).toBe(false)
  })

  it('accepts a hash-derived home once the map is big enough to mean something', () => {
    expect(sharesTurf(hashed('Old Town'), hashed('Old Town'), MIN_LOCATIONS_FOR_TURF_SIGNAL)).toBe(true)
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
