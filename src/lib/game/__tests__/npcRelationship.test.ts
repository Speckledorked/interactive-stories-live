// src/lib/game/__tests__/npcRelationship.test.ts
import { describe, it, expect } from 'vitest'
import { summarizeNpcRelationship } from '../npcRelationship'

describe('summarizeNpcRelationship', () => {
  it('returns nothing for a null/undefined relationship', () => {
    expect(summarizeNpcRelationship(null)).toEqual([])
    expect(summarizeNpcRelationship(undefined)).toEqual([])
  })

  it('returns nothing when every axis is below the notable threshold', () => {
    expect(summarizeNpcRelationship({ trust: 10, tension: -20, respect: 30, fear: 0 })).toEqual([])
  })

  it('labels high trust', () => {
    expect(summarizeNpcRelationship({ trust: 60, tension: 0, respect: 0, fear: 0 })).toEqual(['Trusts you'])
  })

  it('labels low trust as distrust, never both directions at once', () => {
    expect(summarizeNpcRelationship({ trust: -55, tension: 0, respect: 0, fear: 0 })).toEqual(['Distrusts you'])
  })

  it('labels high tension as open hostility', () => {
    expect(summarizeNpcRelationship({ trust: 0, tension: 51, respect: 0, fear: 0 })).toEqual(['Openly hostile toward you'])
  })

  it('labels high and low respect', () => {
    expect(summarizeNpcRelationship({ trust: 0, tension: 0, respect: 75, fear: 0 })).toEqual(['Respects you'])
    expect(summarizeNpcRelationship({ trust: 0, tension: 0, respect: -75, fear: 0 })).toEqual(['Dismisses you'])
  })

  it('labels high fear', () => {
    expect(summarizeNpcRelationship({ trust: 0, tension: 0, respect: 0, fear: 50 })).toEqual(['Fears you'])
  })

  it('combines multiple notable axes in a fixed order', () => {
    expect(
      summarizeNpcRelationship({ trust: 60, tension: 60, respect: -60, fear: 60 })
    ).toEqual(['Fears you', 'Trusts you', 'Openly hostile toward you', 'Dismisses you'])
  })

  it('is exactly threshold-inclusive at the boundary', () => {
    expect(summarizeNpcRelationship({ trust: 50, tension: 0, respect: 0, fear: 0 })).toEqual(['Trusts you'])
    expect(summarizeNpcRelationship({ trust: 49, tension: 0, respect: 0, fear: 0 })).toEqual([])
  })
})
