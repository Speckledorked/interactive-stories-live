import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { applyCharacterChanges, PcChange, findConsequenceToRemove } from '../characters'
import type { Character } from '@prisma/client'

// applyDebtChanges is mocked (it's a DB writer), but debtChangeFromConsequence
// is pure and IS the behavior under test for #69 — mocking it away would
// leave the routing untested.
vi.mock('../../debts', async () => {
  const actual = await vi.importActual<typeof import('../../debts')>('../../debts')
  return { ...actual, applyDebtChanges: vi.fn(async () => ['debt log line']) }
})
vi.mock('../../standing', () => ({ applyStandingChanges: vi.fn(async () => ['standing log line']) }))
vi.mock('../../capabilities', () => ({ applyCapabilityChanges: vi.fn(async () => ['capability log line']) }))
vi.mock('../locations', () => ({ resolveOrCreateLocationId: vi.fn(async () => 'resolved-loc-id') }))

import { applyDebtChanges } from '../../debts'
import { applyStandingChanges } from '../../standing'
import { applyCapabilityChanges } from '../../capabilities'
import { resolveOrCreateLocationId } from '../locations'

const makeTx = () => ({
  character: { update: vi.fn(async (_args: any) => ({})) },
  // Corruption entry gate (#83) looks the destination up by campaign+name.
  location: { findUnique: vi.fn(async (): Promise<{ minCorruption: number | null; maxCorruption: number | null } | null> => null) },
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
    equipment: {}, inventory: { items: [] },
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
      inventory: { items: [{ id: 'a1', name: 'reinforced coat', armorValue: 1 }] },
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

  it('mends harm from a narrated stretch of rest, graded by shelter', async () => {
    // Rest reaches the sheet through the fiction channel, not a button.
    const roster = [character({ harm: 4 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { rest_quality: 'excellent' } } as PcChange,
    ], roster, noTheme, true)
    expect(tx.character.update.mock.calls[0][0].data.harm).toBe(2)
  })

  it('will not let a narrated night of rest mend an open wound', async () => {
    // The loophole this closes: the calendar path already refuses to heal
    // through Bleeding, so rest must refuse too or it becomes the way
    // around that rule.
    const roster = [character({
      harm: 4,
      conditions: { conditions: [{ id: 'b1', name: 'Bleeding', category: 'Physical', description: 'open wound', harmPerScene: 1 }] },
    })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { rest_quality: 'excellent' } } as PcChange,
    ], roster, noTheme, true)
    expect(tx.character.update.mock.calls[0][0].data.harm).toBe(4)
  })

  it('stacks treatment and rest when the fiction gave both', async () => {
    const roster = [character({ harm: 5 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      {
        character_name_or_id: 'char1',
        changes: {
          medical_attention: { skill: 'trained', has_supplies: true },  // -2
          rest_quality: 'adequate',                                     // -1
        },
      } as PcChange,
    ], roster, noTheme, true)
    expect(tx.character.update.mock.calls[0][0].data.harm).toBe(2)
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
    const roster = [character({ inventory: { items: [{ id: 'p1', name: 'Healing Potion', quantity: 1 }] } })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { inventory_changes: { items_add: [{ id: 'p1', name: 'Healing Potion', quantity: 2 }] } } } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    // grantedTurn is stamped on every grant so the next rarity-budget
    // check can derive spend from the inventory itself (#44/#47) — a fresh
    // grant restarts this stack's arc clock, or a stack topped up every
    // scene would evade the budget forever.
    expect(data.inventory.items).toEqual([
      { id: 'p1', name: 'Healing Potion', quantity: 3, grantedTurn: 1 },
    ])
  })

  it("enforces a consumed item's heal effect deterministically, independent of narration", async () => {
    const roster = [character({
      harm: 4,
      inventory: { items: [{ id: 'p1', name: 'Healing Potion', quantity: 1, effect: { kind: 'heal', amount: 2, description: 'Mends wounds.' } }] },
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
      inventory: { items: [{ id: 'p1', name: 'Healing Potion', quantity: 3, effect: { kind: 'heal', amount: 1, description: 'x' } }] },
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
      inventory: { items: [{ id: 'c1', name: 'Warding Charm', quantity: 1, effect: { kind: 'custom', description: 'Wards off one curse.' } }] },
    })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { inventory_changes: { items_remove: ['c1'] } } } as PcChange,
    ], roster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.harm).toBeUndefined()
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

  it('routes a consequences_add debt into the real Debt model (#69)', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      {
        character_name_or_id: 'char1',
        changes: {
          consequences_add: [
            { type: 'debt', description: 'Vashti got them out of the district', counterparty_name: 'Vashti', counterparty_type: 'npc' },
          ],
        },
      } as PcChange,
    ], roster, noTheme, true)

    const changes = vi.mocked(applyDebtChanges).mock.calls[0][4]
    expect(changes).toEqual([
      expect.objectContaining({
        counterparty_name: 'Vashti',
        counterparty_type: 'npc',
        action: 'incur',
        // A bare debt means the party owes someone; inverting it by
        // accident would hand players leverage they never earned.
        direction: 'owed_by_character',
        description: 'Vashti got them out of the district',
      }),
    ])

    // And nothing lands in the freeform string array — that shadow
    // representation is exactly what #69 was about.
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.consequences?.debts ?? []).toEqual([])
  })

  it('merges consequence debts with debt_changes into one writer call', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      {
        character_name_or_id: 'char1',
        changes: {
          debt_changes: [{ counterparty_name: 'Lord Kessler', counterparty_type: 'npc', direction: 'owed_by_character', action: 'incur', description: 'A favor', reason: 'x' }],
          consequences_add: [{ type: 'debt', description: 'Owed the Guild', counterparty_name: 'Thieves Guild', counterparty_type: 'faction' }],
        },
      } as PcChange,
    ], roster, noTheme, true)

    expect(applyDebtChanges).toHaveBeenCalledTimes(1)
    const changes = vi.mocked(applyDebtChanges).mock.calls[0][4]
    expect(changes.map((c: any) => c.counterparty_name)).toEqual(['Lord Kessler', 'Thieves Guild'])
  })

  it('drops a consequence debt with no counterparty rather than inventing one', async () => {
    // A debt owed to nobody can never be called in, so there is nothing
    // useful to write. It must not fall through to the string array either.
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { consequences_add: [{ type: 'debt', description: 'Owes someone, somewhere' }] } } as PcChange,
    ], roster, noTheme, true)

    expect(applyDebtChanges).not.toHaveBeenCalled()
    const data = tx.character.update.mock.calls[0][0].data
    expect(JSON.stringify(data.consequences)).not.toContain('Owes someone')
  })

  it('still writes non-debt consequences to their arrays', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      {
        character_name_or_id: 'char1',
        changes: {
          consequences_add: [
            { type: 'promise', description: 'Swore to return for the child' },
            { type: 'debt', description: 'Owed Vashti', counterparty_name: 'Vashti' },
          ],
        },
      } as PcChange,
    ], roster, noTheme, true)

    const data = tx.character.update.mock.calls[0][0].data
    expect(data.consequences.promises).toEqual(['Swore to return for the child'])
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

// ---------------------------------------------------------------------------
// consequences_remove precision (#69)
// ---------------------------------------------------------------------------
// The previous implementation filtered EVERY consequence array by substring
// simultaneously, so resolving one thing could silently strike unrelated
// promises, enemies and threats that merely shared the wording.

describe('findConsequenceToRemove (#69)', () => {
  const consequences = () => ({
    promises: ['Swore to protect the child', 'Promised Kessler a favor'],
    enemies: ['Kessler wants him dead'],
    longTermThreats: ['The Kessler family will retaliate'],
  })

  it('removes an exact match', () => {
    const found = findConsequenceToRemove(consequences(), 'Kessler wants him dead')
    expect(found).toMatchObject({ key: 'enemies', index: 0 })
  })

  it('is case- and whitespace-insensitive on an exact match', () => {
    const found = findConsequenceToRemove(consequences(), '  kessler WANTS him dead ')
    expect(found).toMatchObject({ key: 'enemies' })
  })

  it('identifies exactly ONE entry even when several share the phrase', () => {
    // "Kessler" appears in four entries across three arrays. The old code
    // deleted all of them at once.
    const found = findConsequenceToRemove(consequences(), 'Kessler')
    expect(found).not.toBeNull()
    // Shortest containing entry wins as the most specific.
    expect(found!.matched).toBe('Kessler wants him dead')
  })

  it('returns null rather than guessing when nothing matches', () => {
    expect(findConsequenceToRemove(consequences(), 'a debt to the crown')).toBeNull()
  })

  it('ignores non-array and non-string members safely', () => {
    const messy = { promises: ['keep me'], notes: 'not an array', enemies: [42, 'real entry'] }
    expect(findConsequenceToRemove(messy as any, 'real entry')).toMatchObject({ key: 'enemies', index: 1 })
  })

  it('returns null for an empty needle instead of matching everything', () => {
    expect(findConsequenceToRemove(consequences(), '   ')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Corruption entry gate (#83)
// ---------------------------------------------------------------------------
// The safety property: gates apply at the BOUNDARY. Marks are irreversible
// and capped at one per scene, so a gate evaluated against where someone
// already stands would eject them through a door they could never re-enter.

describe('applyCharacterChanges — corruption entry gate', () => {
  const theme = vi.fn().mockResolvedValue({ name: 'the Rot', stages: ['marked'] })

  it('refuses a move into a location the character is too marked for', async () => {
    const roster = [character({ corruption: 4 })]
    tx.location.findUnique.mockResolvedValue({ minCorruption: null, maxCorruption: 2 })

    const refusals = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'The High Temple' } } as PcChange,
    ], roster, theme, true)

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toContain('The High Temple')
    // The move did not happen.
    const data = tx.character.update.mock.calls[0]?.[0]?.data
    expect(data?.currentLocation).toBeUndefined()
  })

  it('refuses a move into a place that demands marks the character lacks', async () => {
    const roster = [character({ corruption: 0 })]
    tx.location.findUnique.mockResolvedValue({ minCorruption: 3, maxCorruption: null })

    const refusals = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'The Drowned Shrine' } } as PcChange,
    ], roster, theme, true)

    expect(refusals).toHaveLength(1)
  })

  it('allows a move that satisfies the gate', async () => {
    const roster = [character({ corruption: 3 })]
    tx.location.findUnique.mockResolvedValue({ minCorruption: 3, maxCorruption: null })

    const refusals = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'The Drowned Shrine' } } as PcChange,
    ], roster, theme, true)

    expect(refusals).toEqual([])
    expect(tx.character.update.mock.calls[0][0].data.currentLocation).toBe('The Drowned Shrine')
  })

  it('never gates a campaign with no corruption theme', async () => {
    const roster = [character({ corruption: 5 })]
    tx.location.findUnique.mockResolvedValue({ minCorruption: null, maxCorruption: 0 })

    const refusals = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'The High Temple' } } as PcChange,
    ], roster, noTheme, true)

    expect(refusals).toEqual([])
    expect(tx.character.update.mock.calls[0][0].data.currentLocation).toBe('The High Temple')
  })

  it('never checks a gate when the change is not a move', async () => {
    // This IS the boundary rule: standing state is never re-evaluated, so
    // gaining a mark can never eject anyone from where they already are.
    const roster = [character({ corruption: 5 })]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { harm_damage: 1 } } as PcChange,
    ], roster, theme, true)
    expect(tx.location.findUnique).not.toHaveBeenCalled()
  })

  it('allows the move when the gate lookup fails', async () => {
    // Fails open on purpose: a gate that accidentally refuses movement
    // strands the party, one that accidentally permits it costs flavor.
    const roster = [character({ corruption: 5 })]
    tx.location.findUnique.mockRejectedValue(new Error('db down'))

    const refusals = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'Anywhere' } } as PcChange,
    ], roster, theme, true)

    expect(refusals).toEqual([])
    expect(tx.character.update.mock.calls[0][0].data.currentLocation).toBe('Anywhere')
  })

  it('allows a move into a place that has no row yet', async () => {
    // The fiction inventing a location right now has no row to carry a gate.
    const roster = [character({ corruption: 5 })]
    tx.location.findUnique.mockResolvedValue(null)

    const refusals = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'A Nameless Hollow' } } as PcChange,
    ], roster, theme, true)

    expect(refusals).toEqual([])
  })

  it('does not write harm state when a move is refused', async () => {
    // A refusal is not an injury. Routing it through harmMessages would
    // trigger the harm/conditions write that array doubles as the flag for.
    const roster = [character({ corruption: 4, harm: 0 })]
    tx.location.findUnique.mockResolvedValue({ minCorruption: null, maxCorruption: 1 })

    await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'The High Temple' } } as PcChange,
    ], roster, theme, true)

    const data = tx.character.update.mock.calls[0]?.[0]?.data
    expect(data?.harm).toBeUndefined()
    expect(data?.conditions).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Stock conditions reach the sheet with their effects intact
// ---------------------------------------------------------------------------
// COMMON_CONDITIONS had no production consumer, so a narrator writing
// "Bleeding" produced a condition with whatever fields it happened to
// report — usually none — while the catalogue entry specifying 1 harm per
// scene was true only of a table nobody read.

describe('applyCharacterChanges — stock condition effects', () => {
  it('fills a bare "Bleeding" in from the catalogue so it actually bleeds', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      {
        character_name_or_id: 'char1',
        changes: { conditions_add: [{ name: 'Bleeding', category: 'Physical', description: 'Bleeding badly.' }] },
      } as PcChange,
    ], roster, noTheme, true)

    const data = tx.character.update.mock.calls[0][0].data
    const bleeding = data.conditions.conditions.find((c: any) => c.name === 'Bleeding')
    expect(bleeding.harmPerScene).toBe(1)
  })

  it('fills stat effects in for a stock condition that has them', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      {
        character_name_or_id: 'char1',
        changes: { conditions_add: [{ name: 'Enraged', category: 'Emotional', description: 'Furious.' }] },
      } as PcChange,
    ], roster, noTheme, true)

    const data = tx.character.update.mock.calls[0][0].data
    const enraged = data.conditions.conditions.find((c: any) => c.name === 'Enraged')
    expect(enraged.statModifiers).toEqual({ hard: 1, hot: -2 })
  })

  it('lets an explicitly reported value beat the catalogue', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      {
        character_name_or_id: 'char1',
        changes: { conditions_add: [{ name: 'Bleeding', category: 'Physical', description: 'Arterial.', harmPerScene: 3 }] },
      } as PcChange,
    ], roster, noTheme, true)

    const data = tx.character.update.mock.calls[0][0].data
    expect(data.conditions.conditions.find((c: any) => c.name === 'Bleeding').harmPerScene).toBe(3)
  })

  it('leaves an invented condition exactly as reported', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      {
        character_name_or_id: 'char1',
        changes: { conditions_add: [{ name: 'Moonstruck', category: 'Special', description: 'Touched by the moon.', rollModifier: -1 }] },
      } as PcChange,
    ], roster, noTheme, true)

    const data = tx.character.update.mock.calls[0][0].data
    const invented = data.conditions.conditions.find((c: any) => c.name === 'Moonstruck')
    expect(invented.rollModifier).toBe(-1)
    expect(invented.harmPerScene).toBeUndefined()
  })
})
