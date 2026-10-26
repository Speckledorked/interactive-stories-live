// src/lib/game/__tests__/archetypeLoadout.test.ts
// #508: the mapping two creation paths share, and the one line that
// decides whether a card can start a character at all.

import { describe, it, expect } from 'vitest'
import {
  archetypeLoadout,
  isQuickStartable,
  type ArchetypeCard,
} from '../archetypeLoadout'

function card(overrides: Partial<ArchetypeCard> = {}): ArchetypeCard {
  return {
    id: 'arc1',
    name: 'Newly Awakened Outworlder',
    description: 'You woke here, and nobody will say from where.',
    originFamiliarity: 'OUTSIDER',
    suggestedStats: { might: 1, grace: 0, wits: 2, heart: 1, resolve: 0 },
    startingGear: null,
    startingTie: null,
    backstoryPrompts: [],
    ...overrides,
  }
}

describe('archetypeLoadout', () => {
  it('carries the stats and familiarity through', () => {
    const loadout = archetypeLoadout(card())
    expect(loadout.originFamiliarity).toBe('OUTSIDER')
    expect(loadout.stats).toEqual({ might: 1, grace: 0, wits: 2, heart: 1, resolve: 0 })
  })

  it('names only the equipment slots the card fills', () => {
    // The property that keeps an archetype from blanking gear the player
    // already chose: a card with a weapon and no armor must say nothing
    // about armor, so a caller spreading this leaves theirs alone.
    const loadout = archetypeLoadout(card({ startingGear: { weapon: 'A notched blade' } }))
    expect(loadout.equipment).toEqual({ weapon: 'A notched blade' })
    expect(loadout.equipment).not.toHaveProperty('armor')
  })

  it('treats gear with no named slots as no equipment at all', () => {
    expect(archetypeLoadout(card({ startingGear: { items: [] } })).equipment).toBeNull()
  })

  it('distinguishes "no items" from "an empty list of items"', () => {
    // Both are null, deliberately: a card that lists no items should leave
    // a caller's own items alone rather than clearing them.
    expect(archetypeLoadout(card({ startingGear: null })).items).toBeNull()
    expect(archetypeLoadout(card({ startingGear: { items: [] } })).items).toBeNull()
  })

  it('passes items through without inventing ids', () => {
    // Ids are the caller's job — they are list keys the form generates
    // with a timestamp, and assigning them here would make this impure.
    const items = [{ name: 'Lantern', quantity: 1, tags: ['light'] }]
    const loadout = archetypeLoadout(card({ startingGear: { items } }))
    expect(loadout.items).toEqual(items)
    expect(loadout.items?.[0]).not.toHaveProperty('id')
  })

  it('tolerates a card that carries nothing but its description', () => {
    // Generation is allowed to fail at stats for one archetype while
    // succeeding for its siblings.
    const bare = archetypeLoadout(card({ suggestedStats: null, startingGear: null }))
    expect(bare).toEqual({
      originFamiliarity: 'OUTSIDER',
      stats: null,
      equipment: null,
      items: null,
    })
  })
})

describe('isQuickStartable', () => {
  it('requires stats', () => {
    // Stats are not in PLAYER_EDITABLE_FIELDS, so a character created
    // without them cannot be given them later except by an admin. Offering
    // a one-step start from a statless card hands someone a character they
    // are stuck with.
    expect(isQuickStartable(card())).toBe(true)
    expect(isQuickStartable(card({ suggestedStats: null }))).toBe(false)
    expect(isQuickStartable(card({ suggestedStats: {} }))).toBe(false)
  })

  it('does not care about gear', () => {
    // Gear is editable later and absent gear is a normal card.
    expect(isQuickStartable(card({ startingGear: null }))).toBe(true)
  })
})
