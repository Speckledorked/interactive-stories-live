// src/lib/ai/__tests__/schemaBounds.test.ts
//
// #445 (F-14): every number the AI supplies has a bound, and the bounds are
// tested.
//
// #384 bounded the STEP rather than the result across most of this file and
// wrote down exactly why. Three numeric fields were left bare, and one of
// them — InventoryItemSchema.quantity — sat directly beside the ±100
// items_modify bound it bypassed: `items_add` with `quantity: 1e9` merged
// straight into a character sheet, through the same prompt surface as every
// other AI field, while the field one line down was carefully clamped.
//
// None of #384's bounds had a single test. So this file covers the new ones
// AND the old ones, and adds the structural check that actually prevents the
// next bare field: no `z.number()` in schema.ts without a bound or a written
// exemption.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  InventoryItemSchema,
  StandingChangeSchema,
  RewardGrantSchema,
  PCChangesSchema,
  RelationshipChangeSchema,
  MAX_ITEM_QUANTITY_DELTA_PER_ENTRY,
  MAX_STANDING_DELTA_PER_ENTRY,
  MAX_GOLD_AMOUNT_PER_ENTRY,
  MAX_CORRUPTION_MARKS_PER_ENTRY,
  MAX_RELATIONSHIP_DELTA_PER_ENTRY,
} from '../schema'
import { MAX_GOLD_DELTA_MAGNITUDE } from '@/lib/game/economy'
import { MAX_SHIFT_PER_SCENE } from '@/lib/game/standing'

const item = (quantity: number) => ({ id: 'i1', name: 'Arrow', quantity, tags: [] })

describe('inventory quantity is bounded (#445)', () => {
  it('accepts a real stack', () => {
    expect(InventoryItemSchema.safeParse(item(40)).success).toBe(true)
  })

  it('accepts exactly the bound', () => {
    expect(InventoryItemSchema.safeParse(item(MAX_ITEM_QUANTITY_DELTA_PER_ENTRY)).success).toBe(true)
  })

  it('rejects the value that bypassed the items_modify clamp', () => {
    // The concrete finding. characters.ts adds an incoming quantity to any
    // existing stack, so this was an unbounded write to the character sheet.
    expect(InventoryItemSchema.safeParse(item(1e9)).success).toBe(false)
  })

  it('rejects a negative stack and a fractional one', () => {
    expect(InventoryItemSchema.safeParse(item(-5)).success).toBe(false)
    expect(InventoryItemSchema.safeParse(item(1.5)).success).toBe(false)
  })

  it('bounds the reward path the same way, not just items_add', () => {
    // reward_grant.items is a second door into the same applier. Bounding
    // one and not the other is how the first one got missed.
    expect(RewardGrantSchema.safeParse({ items: [item(1e9)] }).success).toBe(false)
    expect(RewardGrantSchema.safeParse({ items: [item(3)] }).success).toBe(true)
  })
})

describe('gold is bounded at the trust boundary, not only in the applier (#445)', () => {
  it('accepts an ordinary payout', () => {
    expect(RewardGrantSchema.safeParse({ gold: 250 }).success).toBe(true)
  })

  it('rejects an absurd payout instead of clamping it to the ceiling', () => {
    // Clamping would hand the AI the maximum every time it overreached,
    // which makes the backstop the default. Dropping costs it the entry.
    expect(RewardGrantSchema.safeParse({ gold: 1e9 }).success).toBe(false)
  })

  it('rejects a negative reward, which the reward path cannot express', () => {
    expect(RewardGrantSchema.safeParse({ gold: -100 }).success).toBe(false)
  })

  it('bounds resource_changes.gold_delta, which may legitimately be negative', () => {
    const pc = (gold_delta: number) => ({
      character_name_or_id: 'Kess',
      changes: { resource_changes: { gold_delta } },
    })
    expect(PCChangesSchema.safeParse(pc(-40)).success).toBe(true)
    expect(PCChangesSchema.safeParse(pc(1e9)).success).toBe(false)
    expect(PCChangesSchema.safeParse(pc(-1e9)).success).toBe(false)
  })

  it('keeps the schema bound equal to the applier clamp it backstops', () => {
    // schema.ts owns no runtime dependency on lib/game — it is the trust
    // boundary, the appliers are downstream of it. So the two constants are
    // declared separately and this is what keeps them honest.
    expect(MAX_GOLD_AMOUNT_PER_ENTRY).toBe(MAX_GOLD_DELTA_MAGNITUDE)
  })
})

describe('standing and corruption are bounded generously, on purpose (#445)', () => {
  const standing = (delta: number) => ({ faction_name: 'Ashcrown', delta, reason: 'r' })

  it('accepts a delta larger than the applier will actually apply', () => {
    // applyStandingChanges clamps to ±1. Tightening the SCHEMA to ±1 would
    // DROP a reported ±2 that today clamps and lands — a schema bound and an
    // applier clamp are not interchangeable, and this is the case that shows
    // it. The bound here is a finiteness backstop, nothing more.
    expect(MAX_SHIFT_PER_SCENE).toBeLessThan(MAX_STANDING_DELTA_PER_ENTRY)
    expect(StandingChangeSchema.safeParse(standing(2)).success).toBe(true)
    expect(StandingChangeSchema.safeParse(standing(-2)).success).toBe(true)
  })

  it('still rejects an absurd magnitude', () => {
    expect(StandingChangeSchema.safeParse(standing(1e6)).success).toBe(false)
    expect(StandingChangeSchema.safeParse(standing(Infinity)).success).toBe(false)
  })

  it('lets a negative corruption mark through as the no-op it already is', () => {
    // corruption_change sits INSIDE a pc_changes entry, so rejecting it
    // would take that character's harm and conditions down with it.
    // applyCorruptionMarks ignores anything at or below zero.
    const pc = (marks: number) => ({
      character_name_or_id: 'Kess',
      changes: { corruption_change: { marks, reason: 'r' } },
    })
    expect(PCChangesSchema.safeParse(pc(-1)).success).toBe(true)
    expect(PCChangesSchema.safeParse(pc(1)).success).toBe(true)
    expect(PCChangesSchema.safeParse(pc(MAX_CORRUPTION_MARKS_PER_ENTRY + 1)).success).toBe(false)
  })
})

describe('#384\'s own bounds, which had no tests', () => {
  const rel = (trust_delta: number) => ({ entity_id: 'n1', entity_name: 'Vell', trust_delta, reason: 'r' })

  it('bounds a relationship delta', () => {
    expect(RelationshipChangeSchema.safeParse(rel(MAX_RELATIONSHIP_DELTA_PER_ENTRY)).success).toBe(true)
    expect(RelationshipChangeSchema.safeParse(rel(MAX_RELATIONSHIP_DELTA_PER_ENTRY + 1)).success).toBe(false)
  })

  it('bounds an items_modify quantity delta in both directions', () => {
    const pc = (quantity_delta: number) => ({
      character_name_or_id: 'Kess',
      changes: { inventory_changes: { items_modify: [{ id: 'i1', quantity_delta }] } },
    })
    expect(PCChangesSchema.safeParse(pc(MAX_ITEM_QUANTITY_DELTA_PER_ENTRY)).success).toBe(true)
    expect(PCChangesSchema.safeParse(pc(-MAX_ITEM_QUANTITY_DELTA_PER_ENTRY)).success).toBe(true)
    expect(PCChangesSchema.safeParse(pc(MAX_ITEM_QUANTITY_DELTA_PER_ENTRY + 1)).success).toBe(false)
  })
})

describe('no numeric field in schema.ts is left unbounded (#445)', () => {
  // The structural half. Three fields were bare, and the one that mattered
  // sat one line above a carefully-clamped sibling — reading the file was
  // never going to catch the fourth.
  const source = readFileSync(join(process.cwd(), 'src', 'lib', 'ai', 'schema.ts'), 'utf-8')
  const lines = source.split('\n')

  it('finds the numeric fields it is meant to be guarding', () => {
    expect(lines.filter((l) => /z\.number\(\)/.test(l)).length).toBeGreaterThanOrEqual(15)
  })

  it('has no bare z.number() without a bound or a written exemption', () => {
    const offenders: string[] = []
    lines.forEach((line, i) => {
      if (!/z\.number\(\)/.test(line)) return
      // A comment mentioning z.number() is prose, not a field.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
      // The two bounded-helper definitions themselves.
      if (/^const bounded(Delta|Amount) =/.test(line.trim())) return
      // A bound on the same line is the normal case.
      if (/z\.number\(\)[^,]*\.(min|max)\(/.test(line)) return
      // An explicit, reasoned opt-out in the comment block just above.
      const preceding = lines.slice(Math.max(0, i - 12), i).join('\n')
      if (/schema-number-exempt:/.test(preceding)) return
      offenders.push(`schema.ts:${i + 1}: ${line.trim()}`)
    })

    expect(
      offenders,
      'A numeric field the AI supplies with no bound. This is how ' +
      'InventoryItemSchema.quantity came to bypass the ±100 items_modify ' +
      'clamp sitting one line below it. Use boundedDelta/boundedAmount, or ' +
      'mark the field "schema-number-exempt:" with the reason and the name ' +
      'of the applier that bounds it instead.\n  ' + offenders.join('\n  ')
    ).toEqual([])
  })
})
