// src/lib/game/__tests__/itemRegistry.test.ts
import { describe, it, expect } from 'vitest'
import { aggregateInventoryItems, describeAggregatedItem } from '../itemRegistry'

describe('aggregateInventoryItems', () => {
  it('returns nothing for characters with no/empty/malformed inventories', () => {
    expect(aggregateInventoryItems([])).toEqual([])
    expect(aggregateInventoryItems([
      { name: 'Helios', inventory: null },
      { name: 'Mara', inventory: {} },
      { name: 'Tom', inventory: { items: 'not-an-array' } },
    ])).toEqual([])
  })

  it('aggregates one entry per item with a single holder', () => {
    const result = aggregateInventoryItems([
      { name: 'Helios', inventory: { items: [{ id: 'i1', name: 'Essence Vial', quantity: 3, tags: ['magic'] }] } },
    ])
    expect(result).toEqual([
      { name: 'Essence Vial', totalQuantity: 3, holders: [{ characterName: 'Helios', quantity: 3 }], tags: ['magic'] },
    ])
  })

  it('merges the same item across characters, case-insensitively', () => {
    const result = aggregateInventoryItems([
      { name: 'Helios', inventory: { items: [{ id: 'i1', name: 'Rope', quantity: 1, tags: [] }] } },
      { name: 'Mara', inventory: { items: [{ id: 'i2', name: 'rope', quantity: 2, tags: ['mundane'] }] } },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Rope')
    expect(result[0].totalQuantity).toBe(3)
    expect(result[0].holders).toEqual([
      { characterName: 'Helios', quantity: 1 },
      { characterName: 'Mara', quantity: 2 },
    ])
    expect(result[0].tags).toEqual(['mundane'])
  })

  it('treats missing/invalid quantity as 1 and skips nameless items', () => {
    const result = aggregateInventoryItems([
      { name: 'Helios', inventory: { items: [
        { id: 'i1', name: 'Torch' },
        { id: 'i2', name: '', quantity: 5 },
        { id: 'i3', quantity: 5 },
      ] } },
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'Torch', totalQuantity: 1 })
  })

  it('sorts results by item name', () => {
    const result = aggregateInventoryItems([
      { name: 'Helios', inventory: { items: [
        { id: 'i1', name: 'Zweihander', quantity: 1 },
        { id: 'i2', name: 'Amulet', quantity: 1 },
      ] } },
    ])
    expect(result.map(i => i.name)).toEqual(['Amulet', 'Zweihander'])
  })
})

describe('describeAggregatedItem', () => {
  it('lists holders with quantities over 1 and tags when present', () => {
    const text = describeAggregatedItem({
      name: 'Essence Vial',
      totalQuantity: 4,
      holders: [
        { characterName: 'Helios', quantity: 3 },
        { characterName: 'Mara', quantity: 1 },
      ],
      tags: ['magic', 'consumable'],
    })
    expect(text).toContain('Helios (x3)')
    expect(text).toContain('Mara')
    expect(text).not.toContain('Mara (x1)')
    expect(text).toContain('Tags: magic, consumable')
  })
})
