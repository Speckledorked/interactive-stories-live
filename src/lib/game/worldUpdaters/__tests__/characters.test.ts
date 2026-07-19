import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { applyCharacterChanges, PcChange } from '../characters'
import type { Character } from '@prisma/client'

vi.mock('../../debts', () => ({ applyDebtChanges: vi.fn(async () => ['debt log line']) }))
vi.mock('../../standing', () => ({ applyStandingChanges: vi.fn(async () => ['standing log line']) }))
vi.mock('../../capabilities', () => ({ applyCapabilityChanges: vi.fn(async () => ['capability log line']) }))
vi.mock('../locations', () => ({ resolveOrCreateLocationId: vi.fn(async () => 'resolved-loc-id') }))

import { applyDebtChanges } from '../../debts'
import { applyStandingChanges } from '../../standing'
import { applyCapabilityChanges } from '../../capabilities'
import { resolveOrCreateLocationId } from '../locations'

const makeTx = () => ({
  character: { update: vi.fn(async (_args: any) => ({})) },
})

let tx: ReturnType<typeof makeTx>
const noTheme = vi.fn().mockResolvedValue(null)

beforeEach(() => {
  tx = makeTx()
  vi.mocked(applyDebtChanges).mockClear()
  vi.mocked(applyStandingChanges).mockClear()
  vi.mocked(applyCapabilityChanges).mockClear()
  vi.mocked(resolveOrCreateLocationId).mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const character = (over: Partial<Character> = {}): Character =>
  ({
    id: 'char1', name: 'Jason', harm: 0, conditions: null,
    equipment: {}, inventory: { items: [], slots: 10 },
    relationships: null, consequences: null,
    appearance: null, personality: null, resources: null,
    corruption: 0,
    ...over,
  } as Character)

describe('applyCharacterChanges — resolution', () => {
  it('resolves by exact id and updates only what changed', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { location: 'The Docks' } } as PcChange,
    ], roster, noTheme, true)

    expect(tx.character.update).toHaveBeenCalledWith({
      where: { id: 'char1' },
      data: { currentLocation: 'The Docks', locationId: 'resolved-loc-id' },
    })
  })

  it('does nothing (and does not throw) for an unresolvable character', async () => {
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'Nobody', changes: { location: 'Nowhere' } } as PcChange,
    ], [], noTheme, true)
    expect(tx.character.update).not.toHaveBeenCalled()
  })
})

describe('applyCharacterChanges — location FK sync', () => {
  it('resolves/creates the matching Location row and links locationId alongside the free-text field', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 4, [
      { character_name_or_id: 'char1', changes: { location: 'The Rookery' } } as PcChange,
    ], roster, noTheme, true)
    expect(resolveOrCreateLocationId).toHaveBeenCalledWith(tx, 'camp1', 'The Rookery', true)
  })

  it('passes sceneOrigin through to the location resolver unchanged', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 4, [
      { character_name_or_id: 'char1', changes: { location: 'The Rookery' } } as PcChange,
    ], roster, noTheme, false)
    expect(resolveOrCreateLocationId).toHaveBeenCalledWith(tx, 'camp1', 'The Rookery', false)
  })

  it('does not touch locationId when the change carries no location', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 4, [
      { character_name_or_id: 'char1', changes: { harm_damage: 1 } } as PcChange,
    ], roster, noTheme, true)
    expect(resolveOrCreateLocationId).not.toHaveBeenCalled()
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.locationId).toBeUndefined()
  })
})

describe('applyCharacterChanges — harm and conditions', () => {
  it('applies harm damage reduced by a structured armor value', async () => {
    const roster = [character({
      equipment: { armor: 'reinforced coat' },
      inventory: { items: [{ id: 'a1', name: 'reinforced coat', armorValue: 1 }], slots: 10 },
    })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { harm_damage: 3 } } as PcChange,
    ], roster, noTheme, true)

    expect(tx.character.update).toHaveBeenCalledWith({
      where: { id: 'char1' },
      data: expect.objectContaining({ harm: 2 }), // 3 damage - 1 armor
    })
  })

  it('heals harm and does not set isAlive when nothing died', async () => {
    const roster = [character({ harm: 4 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { harm_healing: 2 } } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.harm).toBe(2)
    expect(data.isAlive).toBeUndefined()
  })

  it('adds a structured condition', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      {
        character_name_or_id: 'char1',
        changes: { conditions_add: [{ name: 'Shaken', category: 'Emotional', description: 'Rattled by the ambush.', mechanicalEffect: '-1 to cool' }] },
      } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.conditions.conditions).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Shaken' })])
    )
  })

  it('removes a condition by name, case-insensitively', async () => {
    const roster = [character({
      conditions: { conditions: [{ id: 'c1', name: 'Shaken', category: 'Mental', description: 'x', mechanicalEffect: 'x', appliedAt: 1 }], permanentInjuries: [], deathSaves: 0 },
    })]
    await applyCharacterChanges(tx as any, 'camp1', 2, [
      { character_name_or_id: 'char1', changes: { conditions_remove: ['shaken'] } } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.conditions.conditions).toEqual([])
  })

  it('resolves Taken Out (harm hits 6 for the first time) via a server-side recovery roll, never left to the AI', async () => {
    // Force both d6 dice to 6 -> roll 12 -> "stabilized" outcome (>=10), no secondary randomness.
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const roster = [character({ harm: 3 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { harm_damage: 3 } } as PcChange, // 3 -> 6, crosses the Taken Out threshold
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    // performRecoveryRoll's >=10 branch reduces harm back down to 4.
    expect(data.harm).toBe(4)
  })

  it('applies a death save result while already critically dying', async () => {
    const roster = [character({
      harm: 6,
      conditions: { conditions: [{ id: 'd1', name: 'Critically Dying', category: 'Physical', description: 'x', mechanicalEffect: 'Cannot act', appliedAt: 1 }], permanentInjuries: [], deathSaves: 0 },
    })]
    await applyCharacterChanges(tx as any, 'camp1', 2, [
      { character_name_or_id: 'char1', changes: { death_save_result: 'success' } } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.conditions.conditions.some((c: any) => c.name === 'Critically Dying')).toBe(false)
  })

  it('marks isAlive false and logs a legacy line on a heroic sacrifice', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { heroic_sacrifice: { circumstances: 'Held the bridge alone', effect: 'The others escaped' } } } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.isAlive).toBe(false)
  })
})

describe('applyCharacterChanges — corruption', () => {
  it('does nothing when the campaign has no corruption theme', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { corruption_change: { marks: 1, reason: 'Used the forbidden rite' } } } as PcChange,
    ], roster, noTheme, true)
    expect(tx.character.update).not.toHaveBeenCalled()
  })

  it('applies a corruption mark when a theme is active', async () => {
    const theme = vi.fn().mockResolvedValue({ name: 'The Hunger', stages: [] })
    const roster = [character({ corruption: 1 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { corruption_change: { marks: 1, reason: 'Used the forbidden rite' } } } as PcChange,
    ], roster, theme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.corruption).toBe(2)
  })
})

describe('applyCharacterChanges — appearance, personality, equipment', () => {
  it('appends an appearance change rather than replacing when append is set', async () => {
    const roster = [character({ appearance: 'A long scar across one cheek.' })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { appearance_changes: { description: 'Now walks with a limp.', append: true } } } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.appearance).toBe('A long scar across one cheek. Now walks with a limp.')
  })

  it('replaces personality outright when append is false', async () => {
    const roster = [character({ personality: 'Cheerful and trusting.' })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { personality_changes: { description: 'Withdrawn and suspicious of everyone.', append: false } } } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.personality).toBe('Withdrawn and suspicious of everyone.')
  })

  it('equips a weapon and clears armor on remove', async () => {
    const roster = [character({ equipment: { weapon: '', armor: 'leather jerkin' } })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      {
        character_name_or_id: 'char1',
        changes: { equipment_changes: { weapon: { action: 'add', value: 'rapier' }, armor: { action: 'remove', value: 'leather jerkin' } } },
      } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.equipment).toEqual({ weapon: 'rapier', armor: '' })
  })
})

describe('applyCharacterChanges — inventory', () => {
  it('stacks a newly-added item onto an existing one by id', async () => {
    const roster = [character({ inventory: { items: [{ id: 'p1', name: 'Healing Potion', quantity: 1 }], slots: 10 } })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { inventory_changes: { items_add: [{ id: 'p1', name: 'Healing Potion', quantity: 2 }] } } } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.inventory.items).toEqual([{ id: 'p1', name: 'Healing Potion', quantity: 3 }])
  })

  it("enforces a consumed item's heal effect deterministically, independent of narration", async () => {
    const roster = [character({
      harm: 4,
      inventory: { items: [{ id: 'p1', name: 'Healing Potion', quantity: 1, effect: { kind: 'heal', amount: 2, description: 'Mends wounds.' } }], slots: 10 },
    })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { inventory_changes: { items_remove: ['p1'] } } } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.harm).toBe(2)
    expect(data.inventory.items).toEqual([])
  })

  it('heals proportionally to the quantity consumed via items_modify', async () => {
    const roster = [character({
      harm: 5,
      inventory: { items: [{ id: 'p1', name: 'Healing Potion', quantity: 3, effect: { kind: 'heal', amount: 1, description: 'x' } }], slots: 10 },
    })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { inventory_changes: { items_modify: [{ id: 'p1', quantity_delta: -2 }] } } } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.harm).toBe(3) // 5 - (1 heal x 2 units consumed)
    expect(data.inventory.items[0].quantity).toBe(1)
  })

  it('never enforces a heal effect for a custom-kind item', async () => {
    const roster = [character({
      harm: 4,
      inventory: { items: [{ id: 'c1', name: 'Warding Charm', quantity: 1, effect: { kind: 'custom', description: 'Wards off one curse.' } }], slots: 10 },
    })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { inventory_changes: { items_remove: ['c1'] } } } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.harm).toBeUndefined()
  })

  it('adjusts inventory slots, floored at 0', async () => {
    const roster = [character({ inventory: { items: [], slots: 2 } })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { inventory_changes: { slots_delta: -5 } } } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.inventory.slots).toBe(0)
  })
})

describe('applyCharacterChanges — resources and relationships', () => {
  it('never lets gold go negative', async () => {
    const roster = [character({ resources: { gold: 5, contacts: [], reputation: {} } })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { resource_changes: { gold_delta: -20 } } } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.resources.gold).toBe(0)
  })

  it('does not duplicate a contact already on record', async () => {
    const roster = [character({ resources: { gold: 0, contacts: ['Old Marta'], reputation: {} } })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { resource_changes: { contacts_add: ['Old Marta'] } } } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.resources.contacts).toEqual(['Old Marta'])
  })

  it('clamps relationship deltas to [-100, 100]', async () => {
    const roster = [character({ relationships: { npc1: { trust: 95, tension: 0, respect: 0, fear: 0 } } })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { relationship_changes: [{ entity_id: 'npc1', entity_name: 'Lord Kessler', trust_delta: 20, reason: 'A grand gesture' }] } } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.relationships.npc1.trust).toBe(100)
  })
})

describe('applyCharacterChanges — delegation to debt/standing/capability writers', () => {
  it('delegates debt_changes to applyDebtChanges with the resolved character', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { debt_changes: [{ counterparty_name: 'Lord Kessler', counterparty_type: 'npc', direction: 'owed_by_character', action: 'incur', description: 'A favor', reason: 'x' }] } } as PcChange,
    ], roster, noTheme, true)
    expect(applyDebtChanges).toHaveBeenCalledWith(tx, 'camp1', 'char1', 'Jason', expect.any(Array), 3)
  })

  it('delegates standing_changes to applyStandingChanges', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { standing_changes: [{ faction_name: 'The Ashen Circle', delta: 1, reason: 'x' }] } } as PcChange,
    ], roster, noTheme, true)
    expect(applyStandingChanges).toHaveBeenCalledWith(tx, 'camp1', 'char1', 'Jason', expect.any(Array))
  })

  it('delegates capability_changes to applyCapabilityChanges', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { capability_changes: [{ capability_key: 'lockpicking', change: 'glimpse', reason: 'Watched a master pick a lock' }] } } as PcChange,
    ], roster, noTheme, true)
    expect(applyCapabilityChanges).toHaveBeenCalledWith(tx, 'camp1', 'char1', expect.any(Array), 3, 'scene')
  })
})
