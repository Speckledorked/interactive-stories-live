// src/lib/game/__tests__/inventory.test.ts
// Armor resolution — depth-hardening #33 (see README): resolveArmorValue
// prefers a structured InventoryItem.armorValue over guessing one from the
// equipped name string, falling back to the existing keyword heuristic
// (getArmorReduction) when no structured value is on record.

import { describe, it, expect } from 'vitest'
import { getArmorReduction, resolveArmorValue, CharacterInventory } from '../inventory'

describe('getArmorReduction (keyword heuristic, unchanged)', () => {
  it('reads an explicit "(X armor)" pattern first', () => {
    expect(getArmorReduction('Mystery Cloak (2 armor)')).toBe(2)
  })

  it('classifies heavy/medium/light armor by keyword', () => {
    expect(getArmorReduction('Full Plate')).toBe(3)
    expect(getArmorReduction('Chainmail')).toBe(2)
    expect(getArmorReduction('Leather Jerkin')).toBe(1)
  })

  it('returns 0 for no armor or unrecognized text', () => {
    expect(getArmorReduction('')).toBe(0)
    expect(getArmorReduction(null)).toBe(0)
    expect(getArmorReduction('a fancy hat')).toBe(0)
  })
})

describe('resolveArmorValue', () => {
  it('prefers a structured armorValue on the matching inventory item', () => {
    const inv: CharacterInventory = {
      items: [{ id: 'a1', name: 'Ancestral Ward', quantity: 1, armorValue: 3 }],
    }
    // The name alone gives no keyword hint at all (would resolve to 0 via
    // the heuristic) — the structured value is what actually applies.
    expect(resolveArmorValue(inv, 'Ancestral Ward')).toBe(3)
  })

  it('clamps a structured armorValue to the 0-3 range', () => {
    const inv: CharacterInventory = {
      items: [{ id: 'a1', name: 'Overtuned Plating', quantity: 1, armorValue: 99 }],
    }
    expect(resolveArmorValue(inv, 'Overtuned Plating')).toBe(3)
  })

  it('falls back to the keyword heuristic when the item has no armorValue', () => {
    const inv: CharacterInventory = {
      items: [{ id: 'a1', name: 'Chainmail', quantity: 1 }],
    }
    expect(resolveArmorValue(inv, 'Chainmail')).toBe(2)
  })

  it('falls back to the keyword heuristic when no matching item is found', () => {
    const inv: CharacterInventory = { items: [] }
    expect(resolveArmorValue(inv, 'Full Plate')).toBe(3)
  })

  it('falls back cleanly with no inventory at all', () => {
    expect(resolveArmorValue(null, 'Full Plate')).toBe(3)
    expect(resolveArmorValue(undefined, '')).toBe(0)
  })

  it('is 0 with no armor name', () => {
    expect(resolveArmorValue({ items: [] }, '')).toBe(0)
    expect(resolveArmorValue({ items: [] }, null)).toBe(0)
  })
})
