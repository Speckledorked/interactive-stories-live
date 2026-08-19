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
  // Corruption (#83) and condition (#206) entry gates look the destination
  // up by campaign+name; conditionScore/isContested are optional in the
  // mock type since most tests never set them (undefined derives to the
  // top PROSPEROUS band, i.e. never blocks — see conditionGates.test.ts).
  location: {
    findUnique: vi.fn(async (): Promise<{
      minCorruption: number | null
      maxCorruption: number | null
      conditionScore?: number
      isContested?: boolean
    } | null> => null),
  },
  // StateMutation audit trail (#198) — real inside the same transaction.
  stateMutation: { create: vi.fn(async (_args: any) => ({})) },
})

let tx: ReturnType<typeof makeTx>
const noTheme = vi.fn().mockResolvedValue(null)

// relationship_changes resolve against the real NPC roster before being
// written, so the map stays keyed by ids that readers actually look up.
const npcRoster = [
  { id: 'npc1', name: 'Lord Kessler' },
  { id: 'npc2', name: 'Vashti' },
]

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

// #213: deterministic RNG factory, same convention resolution.test.ts's
// dice-engine tests already use — yields the given 0..1 values in order,
// then repeats. Lets the Taken-Out recovery-roll tests below inject an
// exact sequence instead of globally mocking Math.random.
const seq = (...values: number[]) => {
  let i = 0
  return () => values[i++ % values.length]
}

const character = (over: Partial<Character> = {}): Character =>
  ({
    id: 'char1', name: 'Jason', harm: 0, conditions: null,
    equipment: {}, inventory: { items: [] },
    relationships: null, consequences: null,
    appearance: null, personality: null, resources: null,
    corruption: 0,
    // #213: harm/condition/corruption processing is gated on isAlive —
    // every existing test here already implicitly assumed a living
    // character, so this default preserves that instead of silently
    // breaking every fixture that doesn't explicitly set it.
    isAlive: true,
    ...over,
  } as Character)

describe('applyCharacterChanges — resolution', () => {
  it('resolves by exact id and updates only what changed', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { location: 'The Docks' } } as PcChange,
    ], roster, npcRoster, noTheme, true)

    expect(tx.character.update).toHaveBeenCalledWith({
      where: { id: 'char1' },
      data: { currentLocation: 'The Docks', locationId: 'resolved-loc-id' },
    })
  })

  it('does nothing (and does not throw) for an unresolvable character', async () => {
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'Nobody', changes: { location: 'Nowhere' } } as PcChange,
    ], [], npcRoster, noTheme, true)
    expect(tx.character.update).not.toHaveBeenCalled()
  })
})

describe('applyCharacterChanges — location FK sync', () => {
  it('resolves/creates the matching Location row and links locationId alongside the free-text field', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 4, [
      { character_name_or_id: 'char1', changes: { location: 'The Rookery' } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    expect(resolveOrCreateLocationId).toHaveBeenCalledWith(tx, 'camp1', 'The Rookery', true)
  })

  it('passes sceneOrigin through to the location resolver unchanged', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 4, [
      { character_name_or_id: 'char1', changes: { location: 'The Rookery' } } as PcChange,
    ], roster, npcRoster, noTheme, false)
    expect(resolveOrCreateLocationId).toHaveBeenCalledWith(tx, 'camp1', 'The Rookery', false)
  })

  it('does not touch locationId when the change carries no location', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 4, [
      { character_name_or_id: 'char1', changes: { harm_damage: 1 } } as PcChange,
    ], roster, npcRoster, noTheme, true)
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
    ], roster, npcRoster, noTheme, true)

    expect(tx.character.update).toHaveBeenCalledWith({
      where: { id: 'char1' },
      data: expect.objectContaining({ harm: 2 }), // 3 damage - 1 armor
    })
  })

  it('heals harm and does not set isAlive when nothing died', async () => {
    const roster = [character({ harm: 4 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { harm_healing: 2 } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.harm).toBe(2)
    expect(data.isAlive).toBeUndefined()
  })

  it('mends harm from a narrated stretch of rest, graded by shelter', async () => {
    // Rest reaches the sheet through the fiction channel, not a button.
    const roster = [character({ harm: 4 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { rest_quality: 'excellent' } } as PcChange,
    ], roster, npcRoster, noTheme, true)
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
    ], roster, npcRoster, noTheme, true)
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
    ], roster, npcRoster, noTheme, true)
    expect(tx.character.update.mock.calls[0][0].data.harm).toBe(2)
  })

  it('does not wipe accrued recovery time when writing harm', async () => {
    // A real data-loss bug. The three write sites rebuilt the conditions
    // blob from exactly {conditions, permanentInjuries, deathSaves}, so
    // restHours — added later for natural recovery — was reset to zero by
    // any harm event. A character who took a scratch lost days of mending,
    // silently, and the only symptom would be "healing feels broken".
    const roster = [character({
      harm: 2,
      conditions: { conditions: [], permanentInjuries: [], deathSaves: 0, restHours: 18 },
    })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { harm_damage: 1 } } as PcChange,
    ], roster, npcRoster, noTheme, true)

    const data = tx.character.update.mock.calls[0][0].data
    expect(data.conditions.restHours).toBe(18)
  })

  it('writes a complete harm state, so no field is left undefined', async () => {
    // The structural half of the same fix: every write goes out as a whole
    // HarmState. A field that exists in the type but not in the write is
    // exactly how restHours got lost, so all four are asserted present
    // rather than only the one that broke.
    const roster = [character({ harm: 1 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { harm_damage: 1 } } as PcChange,
    ], roster, npcRoster, noTheme, true)

    const blob = tx.character.update.mock.calls[0][0].data.conditions
    expect(Object.keys(blob).sort()).toEqual(
      ['conditionHistory', 'conditions', 'deathSaves', 'permanentInjuries', 'restHours']
    )
  })

  it('adds a structured condition', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      {
        character_name_or_id: 'char1',
        changes: { conditions_add: [{ name: 'Shaken', category: 'Emotional', description: 'Rattled by the ambush.', mechanicalEffect: '-1 to cool' }] },
      } as PcChange,
    ], roster, npcRoster, noTheme, true)
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
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.conditions.conditions).toEqual([])
  })

  it('records a removed condition in conditionHistory — the event survives even though current state no longer shows it (#173)', async () => {
    const roster = [character({
      conditions: { conditions: [{ id: 'c1', name: 'Restrained', category: 'Physical', description: 'x', mechanicalEffect: 'x', appliedAt: 1 }], permanentInjuries: [], deathSaves: 0, conditionHistory: [] },
    })]
    await applyCharacterChanges(tx as any, 'camp1', 5, [
      { character_name_or_id: 'char1', changes: { conditions_remove: ['restrained'] } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.conditions.conditions).toEqual([])
    expect(data.conditions.conditionHistory).toEqual([
      { name: 'Restrained', category: 'Physical', appliedAt: 1, resolvedAt: 5 }
    ])
  })

  it('resolves Taken Out (harm hits 6 for the first time) via a server-side recovery roll, never left to the AI', async () => {
    // #213: the roll used to be untestable without globally mocking
    // Math.random (characters.test.ts used to do exactly that here) — it
    // now takes the same injectable Rng resolution.ts's dice engine uses.
    // Force both d6 dice to 6 -> roll 12 -> "stabilized" outcome (>=10).
    const roster = [character({ harm: 3 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { harm_damage: 3 } } as PcChange, // 3 -> 6, crosses the Taken Out threshold
    ], roster, npcRoster, noTheme, true, [], seq(0.99))
    const data = tx.character.update.mock.calls[0][0].data
    // performRecoveryRoll's >=10 branch reduces harm back down to 4.
    expect(data.harm).toBe(4)
  })

  it('a lower recovery roll (7-9) lands the permanent-injury branch, itself picked via the same injected rng', async () => {
    // Two d6 rolls of 0 -> 1+1=2, too low for the injury branch — need a
    // roll in [7,9]. rng() values: dice1=0.5->4, dice2=0.166->2 -> 6, still
    // short. Use 0.5,0.5 -> 4+4=8 (in the 7-9 band), then a THIRD rng() call
    // picks which permanent injury from PERMANENT_INJURIES — 0 always picks
    // the same (first) key deterministically, proving the pick is no longer
    // an untestable raw Math.random() call.
    const roster = [character({ harm: 3 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { harm_damage: 3 } } as PcChange,
    ], roster, npcRoster, noTheme, true, [], seq(0.5, 0.5, 0))
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.harm).toBe(5)
    expect(data.conditions.permanentInjuries).toHaveLength(1)

    // Same dice, different injury-pick rng value -> a different injury,
    // proving the pick genuinely reads from the injected sequence rather
    // than always taking the same branch regardless of the value passed.
    const roster2 = [character({ harm: 3 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { harm_damage: 3 } } as PcChange,
    ], roster2, npcRoster, noTheme, true, [], seq(0.5, 0.5, 0.99))
    const data2 = tx.character.update.mock.calls[1][0].data
    expect(data2.conditions.permanentInjuries[0].id).not.toBe(data.conditions.permanentInjuries[0].id)
  })

  it('defaults to Math.random when no rng is injected, preserving real-caller behavior unchanged', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const roster = [character({ harm: 3 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { harm_damage: 3 } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    expect(randomSpy).toHaveBeenCalled()
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.harm).toBe(4)
  })

  it('applies a death save result while already critically dying', async () => {
    const roster = [character({
      harm: 6,
      conditions: { conditions: [{ id: 'd1', name: 'Critically Dying', category: 'Physical', description: 'x', mechanicalEffect: 'Cannot act', appliedAt: 1 }], permanentInjuries: [], deathSaves: 0 },
    })]
    await applyCharacterChanges(tx as any, 'camp1', 2, [
      { character_name_or_id: 'char1', changes: { death_save_result: 'success' } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.conditions.conditions.some((c: any) => c.name === 'Critically Dying')).toBe(false)
  })

  it('marks isAlive false and logs a legacy line on a heroic sacrifice', async () => {
    // #385: a sacrifice is a character already in mortal danger choosing to
    // spend their life. SERIOUSLY WOUNDED (harm 4) clears that bar.
    const roster = [character({ harm: 4 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { heroic_sacrifice: { circumstances: 'Held the bridge alone', effect: 'The others escaped' } } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.isAlive).toBe(false)
  })

  // #385: the highest-stakes irreversible transition in the product, and it
  // had NO precondition — no confirmation, no harm threshold, no isDying
  // check — on a path reachable from player-authored prompt text. Compare
  // death_save_result, which was always gated on isDying: the codebase
  // already knew this needed a precondition; this path just never got one.
  it('refuses a heroic sacrifice for a character in no danger', async () => {
    const roster = [character({ harm: 0 })]

    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { heroic_sacrifice: { circumstances: 'Nothing was happening', effect: 'None' } } } as PcChange,
    ], roster, npcRoster, noTheme, true)

    const killed = tx.character.update.mock.calls.some((c: any) => c[0].data?.isAlive === false)
    expect(killed).toBe(false)
  })

  it('allows a sacrifice from a character who is already dying', async () => {
    const roster = [character({ harm: 6 })]

    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { heroic_sacrifice: { circumstances: 'One last shove', effect: 'The door held' } } } as PcChange,
    ], roster, npcRoster, noTheme, true)

    const data = tx.character.update.mock.calls[0][0].data
    expect(data.isAlive).toBe(false)
  })
})

describe('applyCharacterChanges — dead characters cannot be physically mutated (#213)', () => {
  const deadRoster = () => [character({ isAlive: false, harm: 3 })]

  it('ignores harm_damage reported against a dead character', async () => {
    // Below stress.ts's SERIOUS_HARM_THRESHOLD (2) so the separate,
    // un-gated stress-drift signal (which reads the raw reported
    // harm_damage, not whether it was actually applied) doesn't itself
    // trigger an update — this test is isolated to the harm-gating path.
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { harm_damage: 1 } } as PcChange,
    ], deadRoster(), npcRoster, noTheme, true)
    expect(tx.character.update).not.toHaveBeenCalled()
  })

  it('ignores harm_healing reported against a dead character', async () => {
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { harm_healing: 2 } } as PcChange,
    ], deadRoster(), npcRoster, noTheme, true)
    expect(tx.character.update).not.toHaveBeenCalled()
  })

  it('ignores conditions_add/conditions_remove reported against a dead character', async () => {
    const roster = [character({
      isAlive: false,
      conditions: { conditions: [{ id: 'b1', name: 'Bleeding', category: 'Physical', description: 'x', harmPerScene: 1 }] },
    })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      {
        character_name_or_id: 'char1',
        changes: { conditions_add: [{ name: 'Enraged' }], conditions_remove: ['Bleeding'] },
      } as PcChange,
    ], roster, npcRoster, noTheme, true)
    expect(tx.character.update).not.toHaveBeenCalled()
  })

  it('ignores medical_attention and rest_quality reported against a dead character', async () => {
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      {
        character_name_or_id: 'char1',
        changes: { medical_attention: { skill: 'trained', has_supplies: true }, rest_quality: 'excellent' },
      } as PcChange,
    ], deadRoster(), npcRoster, noTheme, true)
    expect(tx.character.update).not.toHaveBeenCalled()
  })

  it('ignores a death_save_result reported against an already-dead character', async () => {
    const roster = [character({
      isAlive: false,
      harm: 6,
      conditions: { conditions: [{ id: 'd1', name: 'Critically Dying', category: 'Physical', description: 'x', mechanicalEffect: 'Cannot act', appliedAt: 1 }], permanentInjuries: [], deathSaves: 0 },
    })]
    await applyCharacterChanges(tx as any, 'camp1', 2, [
      { character_name_or_id: 'char1', changes: { death_save_result: 'success' } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    expect(tx.character.update).not.toHaveBeenCalled()
  })

  it('ignores heroic_sacrifice reported against an already-dead character', async () => {
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { heroic_sacrifice: { circumstances: 'x', effect: 'y' } } } as PcChange,
    ], deadRoster(), npcRoster, noTheme, true)
    expect(tx.character.update).not.toHaveBeenCalled()
  })

  it('ignores corruption_change reported against a dead character, even with an active corruption theme', async () => {
    const theme = vi.fn().mockResolvedValue({ name: 'The Hollowing', description: 'x', stages: ['a', 'b', 'c', 'd', 'e'], bargainGuidance: 'x' })
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { corruption_change: { marks: 1, reason: 'a dark bargain' } } } as PcChange,
    ], deadRoster(), npcRoster, theme, true)
    expect(tx.character.update).not.toHaveBeenCalled()
  })

  it('does not let a consumed healing item heal a dead character', async () => {
    const roster = [character({
      isAlive: false,
      harm: 5,
      inventory: { items: [{ id: 'p1', name: 'Healing Potion', quantity: 1, effect: { kind: 'heal', amount: 2, description: 'Mends wounds.' } }] },
    })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { inventory_changes: { items_remove: ['p1'] } } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    // The item is still removed (loot/consumption isn't gated), but harm
    // must stay untouched — a corpse cannot be healed by a potion used on it.
    expect(data.inventory.items).toEqual([])
    expect(data.harm).toBeUndefined()
  })

  it('still processes non-physical changes (location, knowledge, relationships, inventory) for a dead character', async () => {
    const roster = [character({ isAlive: false })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { knowledge_add: [{ key: 'fact', label: 'A fact' }] } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.knownConcepts.concepts).toEqual([
      { key: 'fact', label: 'A fact', source: undefined, learnedAt: 1 }
    ])
    // No harm/condition write was ever triggered for this dead character.
    expect(data.harm).toBeUndefined()
  })
})

describe('applyCharacterChanges — knowledge (#173/#174)', () => {
  it('adds a new known concept', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 4, [
      { character_name_or_id: 'char1', changes: { knowledge_add: [{ key: 'essences_exist', label: 'Essences exist' }] } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.knownConcepts.concepts).toEqual([
      { key: 'essences_exist', label: 'Essences exist', source: undefined, learnedAt: 4 }
    ])
  })

  it('re-reporting the same key refreshes the label without duplicating the entry', async () => {
    const roster = [character({
      knownConcepts: { concepts: [{ key: 'baron', label: "Something's off about the baron", learnedAt: 2 }] },
    })]
    await applyCharacterChanges(tx as any, 'camp1', 7, [
      { character_name_or_id: 'char1', changes: { knowledge_add: [{ key: 'baron', label: 'The baron is secretly a vampire' }] } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.knownConcepts.concepts).toEqual([
      { key: 'baron', label: 'The baron is secretly a vampire', source: undefined, learnedAt: 2 }
    ])
  })

  it('removes a known concept by key', async () => {
    const roster = [character({
      knownConcepts: { concepts: [{ key: 'wrong_fact', label: 'Something untrue', learnedAt: 1 }] },
    })]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { knowledge_remove: ['wrong_fact'] } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.knownConcepts.concepts).toEqual([])
  })

  it('does not touch knownConcepts when nothing knowledge-related changed', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { harm_damage: 1 } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.knownConcepts).toBeUndefined()
  })
})

describe('applyCharacterChanges — WorldChange emission (#175)', () => {
  it('reports one WorldChange per changed field, derived from the real diff', async () => {
    const roster = [character({ harm: 0 })]
    const result = await applyCharacterChanges(tx as any, 'camp1', 4, [
      { character_name_or_id: 'char1', changes: { harm_damage: 3 } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    expect(result.worldChanges).toEqual([
      expect.objectContaining({
        campaignId: 'camp1', entityType: 'CHARACTER', entityId: 'char1', field: 'harm',
        previousValue: 0, newValue: 3, origin: 'sceneResolution', significant: true,
      }),
    ])
  })

  it('reports isAlive at MAJOR importance', async () => {
    const roster = [character({ harm: 6, isAlive: true, conditions: { conditions: [{ id: 'd1', name: 'Critically Dying', category: 'Physical', description: 'x', mechanicalEffect: 'Cannot act', appliedAt: 1 }], permanentInjuries: [], deathSaves: 2 } })]
    const result = await applyCharacterChanges(tx as any, 'camp1', 5, [
      { character_name_or_id: 'char1', changes: { death_save_result: 'failure' } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    expect(result.worldChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'isAlive', previousValue: 'alive', newValue: 'deceased', importance: 'MAJOR' }),
    ]))
  })

  it('does not report Character.relationships — hidden from players by design', async () => {
    const roster = [character()]
    const result = await applyCharacterChanges(tx as any, 'camp1', 1, [
      {
        character_name_or_id: 'char1',
        changes: { relationship_changes: [{ entity_id: 'npc1', entity_name: 'Lord Kessler', trust_delta: 10, reason: 'Saved their life' }] },
      } as PcChange,
    ], roster, npcRoster, noTheme, true)
    expect(result.worldChanges.some(c => c.field === 'relationships')).toBe(false)
  })

  it('reports no WorldChanges when nothing on the character actually changed', async () => {
    const roster = [character()]
    const result = await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: {} } as PcChange,
    ], roster, npcRoster, noTheme, true)
    expect(result.worldChanges).toEqual([])
  })
})

describe('applyCharacterChanges — corruption', () => {
  it('does nothing when the campaign has no corruption theme', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { corruption_change: { marks: 1, reason: 'Used the forbidden rite' } } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    expect(tx.character.update).not.toHaveBeenCalled()
  })

  it('applies a corruption mark when a theme is active', async () => {
    const theme = vi.fn().mockResolvedValue({ name: 'The Hunger', stages: [] })
    const roster = [character({ corruption: 1 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { corruption_change: { marks: 1, reason: 'Used the forbidden rite' } } } as PcChange,
    ], roster, npcRoster, theme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.corruption).toBe(2)
  })
})

describe('applyCharacterChanges — stress (NPC motivation model\'s PC counterpart)', () => {
  it('raises stress on a miss reported by the engine\'s own action_mechanics, not an AI self-report', async () => {
    const roster = [character({ stress: 0 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: {} } as PcChange,
    ], roster, npcRoster, noTheme, true, [
      { characterId: 'char1', outcome: 'miss' } as any,
    ])
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.stress).toBe(1)
  })

  it('does not raise stress for a strongHit or weakHit', async () => {
    const roster = [character({ stress: 3 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: {} } as PcChange,
    ], roster, npcRoster, noTheme, true, [
      { characterId: 'char1', outcome: 'strongHit' } as any,
    ])
    // No raise event fired, so this is a decay case (3 -> 2), not a no-op —
    // confirms strongHit/weakHit never count as pressure on their own.
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.stress).toBe(2)
  })

  it('serious harm (>=2) raises stress double an ordinary event', async () => {
    const roster = [character({ stress: 0 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { harm_damage: 2 } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.stress).toBe(2)
  })

  it('a graze (harm 1) does not raise stress', async () => {
    const roster = [character({ stress: 0, harm: 0 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { harm_damage: 1 } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.stress).toBeUndefined()
  })

  it('a costly consequence (enemy) raises stress; a promise does not', async () => {
    const roster = [character({ stress: 0 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { consequences_add: [{ type: 'enemy', description: 'The captain remembers your face' }] } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.stress).toBe(1)
  })

  it('a real applied corruption mark raises stress in the same exchange it lands', async () => {
    const theme = vi.fn().mockResolvedValue({ name: 'The Hunger', stages: [] })
    const roster = [character({ corruption: 0, stress: 0 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { corruption_change: { marks: 1, reason: 'Used the forbidden rite' } } } as PcChange,
    ], roster, npcRoster, theme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.corruption).toBe(1)
    expect(data.stress).toBe(1)
  })

  it('recovers (decays) on a quiet exchange with none of the raise signals', async () => {
    const roster = [character({ stress: 4 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { location: 'The Docks' } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.stress).toBe(3)
  })

  it('never writes stress when it would be a no-op (already at floor, nothing to decay)', async () => {
    const roster = [character({ stress: 0 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { location: 'The Docks' } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.stress).toBeUndefined()
  })

  it('stacks multiple raise signals in the same exchange', async () => {
    const roster = [character({ stress: 0 })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { harm_damage: 3, consequences_add: [{ type: 'longTermThreat', description: 'They know where you sleep now' }] } } as PcChange,
    ], roster, npcRoster, noTheme, true, [
      { characterId: 'char1', outcome: 'miss' } as any,
    ])
    const data = tx.character.update.mock.calls[0][0].data
    // MISS_TAKEN (1) + HARM_TAKEN (2) + CONSEQUENCE_COST (1) = 4
    expect(data.stress).toBe(4)
  })
})

describe('applyCharacterChanges — appearance, personality, equipment', () => {
  it('appends an appearance change rather than replacing when append is set', async () => {
    const roster = [character({ appearance: 'A long scar across one cheek.' })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { appearance_changes: { description: 'Now walks with a limp.', append: true } } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.appearance).toBe('A long scar across one cheek. Now walks with a limp.')
  })

  it('replaces personality outright when append is false', async () => {
    const roster = [character({ personality: 'Cheerful and trusting.' })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { personality_changes: { description: 'Withdrawn and suspicious of everyone.', append: false } } } as PcChange,
    ], roster, npcRoster, noTheme, true)
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
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.equipment).toEqual({ weapon: 'rapier', armor: '' })
  })
})

describe('applyCharacterChanges — inventory', () => {
  it('stacks a newly-added item onto an existing one by id', async () => {
    const roster = [character({ inventory: { items: [{ id: 'p1', name: 'Healing Potion', quantity: 1 }] } })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { inventory_changes: { items_add: [{ id: 'p1', name: 'Healing Potion', quantity: 2 }] } } } as PcChange,
    ], roster, npcRoster, noTheme, true)
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
    ], roster, npcRoster, noTheme, true)
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
    ], roster, npcRoster, noTheme, true)
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
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.harm).toBeUndefined()
  })

})

describe('applyCharacterChanges — resources and relationships', () => {
  it('REFUSES an unaffordable spend rather than draining the purse to zero', async () => {
    // This used to assert gold === 0: overspending took everything the
    // character had and let the purchase stand. That meant nobody could ever
    // fail to afford anything, so "I can't cover this" was never a reason to
    // bargain, borrow, lie or steal — the economy could not say no.
    const roster = [character({ resources: { gold: 5, contacts: [], reputation: {} } })]

    const result = await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { resource_changes: { gold_delta: -20 } } } as PcChange,
    ], roster, npcRoster, noTheme, true)

    // Untouched, not zeroed.
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.resources.gold).toBe(5)
    // And the refusal is reported, not swallowed — the narration described a
    // purchase that did not happen.
    expect(result.gateRefusals.join(' ')).toMatch(/could not afford/)
    expect(result.gateRefusals.join(' ')).toMatch(/short 15/)
  })

  it('still charges a spend the character can cover', async () => {
    const roster = [character({ resources: { gold: 50, contacts: [], reputation: {} } })]

    const result = await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { resource_changes: { gold_delta: -20 } } } as PcChange,
    ], roster, npcRoster, noTheme, true)

    expect(tx.character.update.mock.calls[0][0].data.resources.gold).toBe(30)
    expect(result.gateRefusals).toEqual([])
  })

  it('never gates a gain — only spending is checked', async () => {
    const roster = [character({ resources: { gold: 0, contacts: [], reputation: {} } })]

    const result = await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { resource_changes: { gold_delta: 40 } } } as PcChange,
    ], roster, npcRoster, noTheme, true)

    expect(tx.character.update.mock.calls[0][0].data.resources.gold).toBe(40)
    expect(result.gateRefusals).toEqual([])
  })

  it('does not duplicate a contact already on record', async () => {
    const roster = [character({ resources: { gold: 0, contacts: ['Old Marta'], reputation: {} } })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { resource_changes: { contacts_add: ['Old Marta'] } } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.resources.contacts).toEqual(['Old Marta'])
  })

  it('clamps relationship deltas to [-100, 100]', async () => {
    const roster = [character({ relationships: { npc1: { trust: 95, tension: 0, respect: 0, fear: 0 } } })]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { relationship_changes: [{ entity_id: 'npc1', entity_name: 'Lord Kessler', trust_delta: 20, reason: 'A grand gesture' }] } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.relationships.npc1.trust).toBe(100)
  })

  // The map is keyed by NPC id and every reader looks it up that way
  // (resolution.ts's roll lookup, socialTies.ts, questFailure.ts), so an
  // unresolved key is a change that silently never applies to anything.
  it('keys a relationship change by the resolved NPC id when the AI sends a name as the id', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { relationship_changes: [{ entity_id: 'Lord Kessler', entity_name: 'Lord Kessler', trust_delta: 10, reason: 'Saved their life' }] } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.relationships.npc1.trust).toBe(10)
    expect(data.relationships['Lord Kessler']).toBeUndefined()
  })

  it('falls back to entity_name when entity_id is a placeholder the AI invented', async () => {
    // The prompt's own example used to show "npc_123", so this is the
    // routine case rather than the exceptional one.
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { relationship_changes: [{ entity_id: 'npc_123', entity_name: 'Vashti', trust_delta: -5, reason: 'Broke a promise' }] } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    const data = tx.character.update.mock.calls[0][0].data
    expect(data.relationships.npc2.trust).toBe(-5)
    expect(data.relationships.npc_123).toBeUndefined()
  })

  it('skips a relationship change naming an NPC that does not exist, rather than writing an orphan key', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 1, [
      { character_name_or_id: 'char1', changes: { relationship_changes: [{ entity_id: 'ghost', entity_name: 'Someone Who Never Existed', trust_delta: 10, reason: 'x' }] } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    // Nothing resolved, so there is nothing to write at all — not even an
    // unchanged relationships column.
    expect(tx.character.update).not.toHaveBeenCalled()
  })

  // #198 — every relationship_changes outcome gets a persisted StateMutation
  // row, not just a console.warn that's gone the moment the log scrolls.
  describe('StateMutation audit trail', () => {
    it('records ACCEPTED when entity_id resolves exactly as reported', async () => {
      const roster = [character()]
      await applyCharacterChanges(tx as any, 'camp1', 1, [
        { character_name_or_id: 'char1', changes: { relationship_changes: [{ entity_id: 'npc1', entity_name: 'Lord Kessler', trust_delta: 10, reason: 'x' }] } } as PcChange,
      ], roster, npcRoster, noTheme, true)

      expect(tx.stateMutation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          campaignId: 'camp1',
          field: 'character.char1.relationships.npc1',
          result: 'ACCEPTED',
        }),
      })
    })

    it('records REPAIRED when entity_id is a placeholder and resolution needed the entity_name fallback', async () => {
      const roster = [character()]
      await applyCharacterChanges(tx as any, 'camp1', 1, [
        { character_name_or_id: 'char1', changes: { relationship_changes: [{ entity_id: 'npc_123', entity_name: 'Vashti', trust_delta: -5, reason: 'x' }] } } as PcChange,
      ], roster, npcRoster, noTheme, true)

      expect(tx.stateMutation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          field: 'character.char1.relationships.npc2',
          result: 'REPAIRED',
          repairedValue: { trust: -5, tension: 0, respect: 0, fear: 0 },
        }),
      })
    })

    it('records ACCEPTED (not REPAIRED) when entity_id itself contains a name that resolves without needing the fallback', async () => {
      // entity_id holding a name string, resolved by the FIRST call's own
      // name-matching, is a different (weaker) signal than "the entity_name
      // fallback was actually needed" — this stays ACCEPTED under that
      // narrower, code-structure-grounded REPAIRED definition.
      const roster = [character()]
      await applyCharacterChanges(tx as any, 'camp1', 1, [
        { character_name_or_id: 'char1', changes: { relationship_changes: [{ entity_id: 'Lord Kessler', entity_name: 'Lord Kessler', trust_delta: 10, reason: 'x' }] } } as PcChange,
      ], roster, npcRoster, noTheme, true)

      expect(tx.stateMutation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          field: 'character.char1.relationships.npc1',
          result: 'ACCEPTED',
        }),
      })
    })

    it('records REJECTED with a reason when the target NPC never resolves', async () => {
      const roster = [character()]
      await applyCharacterChanges(tx as any, 'camp1', 1, [
        { character_name_or_id: 'char1', changes: { relationship_changes: [{ entity_id: 'ghost', entity_name: 'Someone Who Never Existed', trust_delta: 10, reason: 'x' }] } } as PcChange,
      ], roster, npcRoster, noTheme, true)

      expect(tx.stateMutation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          campaignId: 'camp1',
          field: 'character.char1.relationships.ghost',
          result: 'REJECTED',
          reason: expect.stringContaining('Someone Who Never Existed'),
        }),
      })
    })

    it('never lets a StateMutation write failure affect the relationship change it describes', async () => {
      tx.stateMutation.create.mockRejectedValueOnce(new Error('DB unavailable'))
      const roster = [character()]
      await expect(applyCharacterChanges(tx as any, 'camp1', 1, [
        { character_name_or_id: 'char1', changes: { relationship_changes: [{ entity_id: 'npc1', entity_name: 'Lord Kessler', trust_delta: 10, reason: 'x' }] } } as PcChange,
      ], roster, npcRoster, noTheme, true)).resolves.toBeDefined()

      const data = tx.character.update.mock.calls[0][0].data
      expect(data.relationships.npc1.trust).toBe(10)
    })
  })
})

describe('applyCharacterChanges — delegation to debt/standing/capability writers', () => {
  it('delegates debt_changes to applyDebtChanges with the resolved character', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { debt_changes: [{ counterparty_name: 'Lord Kessler', counterparty_type: 'npc', direction: 'owed_by_character', action: 'incur', description: 'A favor', reason: 'x' }] } } as PcChange,
    ], roster, npcRoster, noTheme, true)
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
    ], roster, npcRoster, noTheme, true)

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
    ], roster, npcRoster, noTheme, true)

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
    ], roster, npcRoster, noTheme, true)

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
    ], roster, npcRoster, noTheme, true)

    const data = tx.character.update.mock.calls[0][0].data
    // Records now, not bare strings — a string has no status, which is why
    // nothing could ever be retired. `since` is the turn it was incurred.
    expect(data.consequences.promises).toEqual([
      { text: 'Swore to return for the child', status: 'active', since: 3 },
    ])
  })

  it('RETIRES a consequence rather than deleting it', async () => {
    // The old path spliced the entry out, which made surviving a threat
    // indistinguishable from it never having existed.
    const roster = [character({
      consequences: { promises: [], debts: [], enemies: ['Hunted by Ironveil'], longTermThreats: [] },
    })]

    await applyCharacterChanges(tx as any, 'camp1', 11, [
      {
        character_name_or_id: 'char1',
        changes: { consequences_remove: ['Hunted by Ironveil'] },
      } as PcChange,
    ], roster, npcRoster, noTheme, true)

    const data = tx.character.update.mock.calls[0][0].data
    expect(data.consequences.enemies).toEqual([
      { text: 'Hunted by Ironveil', status: 'resolved', resolvedAt: 11 },
    ])
  })

  it('resolves a legacy string entry, so old campaigns are not stranded', async () => {
    // Everything already on disk is a bare string. If removal only worked
    // against the new shape, no existing threat could ever be retired.
    const roster = [character({
      consequences: { longTermThreats: ['The silver route will come looking'] },
    })]

    await applyCharacterChanges(tx as any, 'camp1', 5, [
      {
        character_name_or_id: 'char1',
        changes: { consequences_remove: ['silver route'] },
      } as PcChange,
    ], roster, npcRoster, noTheme, true)

    const data = tx.character.update.mock.calls[0][0].data
    expect(data.consequences.longTermThreats).toEqual([
      { text: 'The silver route will come looking', status: 'resolved', resolvedAt: 5 },
    ])
  })

  it('delegates standing_changes to applyStandingChanges', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { standing_changes: [{ faction_name: 'The Ashen Circle', delta: 1, reason: 'x' }] } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    expect(applyStandingChanges).toHaveBeenCalledWith(tx, 'camp1', 'char1', 'Jason', expect.any(Array))
  })

  it('delegates capability_changes to applyCapabilityChanges', async () => {
    const roster = [character()]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { capability_changes: [{ capability_key: 'lockpicking', change: 'glimpse', reason: 'Watched a master pick a lock' }] } } as PcChange,
    ], roster, npcRoster, noTheme, true)
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

    const { gateRefusals: refusals } = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'The High Temple' } } as PcChange,
    ], roster, npcRoster, theme, true)

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toContain('The High Temple')
    // The move did not happen.
    const data = tx.character.update.mock.calls[0]?.[0]?.data
    expect(data?.currentLocation).toBeUndefined()
  })

  it('refuses a move into a place that demands marks the character lacks', async () => {
    const roster = [character({ corruption: 0 })]
    tx.location.findUnique.mockResolvedValue({ minCorruption: 3, maxCorruption: null })

    const { gateRefusals: refusals } = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'The Drowned Shrine' } } as PcChange,
    ], roster, npcRoster, theme, true)

    expect(refusals).toHaveLength(1)
  })

  it('allows a move that satisfies the gate', async () => {
    const roster = [character({ corruption: 3 })]
    tx.location.findUnique.mockResolvedValue({ minCorruption: 3, maxCorruption: null })

    const { gateRefusals: refusals } = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'The Drowned Shrine' } } as PcChange,
    ], roster, npcRoster, theme, true)

    expect(refusals).toEqual([])
    expect(tx.character.update.mock.calls[0][0].data.currentLocation).toBe('The Drowned Shrine')
  })

  it('never gates a campaign with no corruption theme', async () => {
    const roster = [character({ corruption: 5 })]
    tx.location.findUnique.mockResolvedValue({ minCorruption: null, maxCorruption: 0 })

    const { gateRefusals: refusals } = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'The High Temple' } } as PcChange,
    ], roster, npcRoster, noTheme, true)

    expect(refusals).toEqual([])
    expect(tx.character.update.mock.calls[0][0].data.currentLocation).toBe('The High Temple')
  })

  it('never checks a gate when the change is not a move', async () => {
    // This IS the boundary rule: standing state is never re-evaluated, so
    // gaining a mark can never eject anyone from where they already are.
    const roster = [character({ corruption: 5 })]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { harm_damage: 1 } } as PcChange,
    ], roster, npcRoster, theme, true)
    expect(tx.location.findUnique).not.toHaveBeenCalled()
  })

  it('allows the move when the gate lookup fails', async () => {
    // Fails open on purpose: a gate that accidentally refuses movement
    // strands the party, one that accidentally permits it costs flavor.
    const roster = [character({ corruption: 5 })]
    tx.location.findUnique.mockRejectedValue(new Error('db down'))

    const { gateRefusals: refusals } = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'Anywhere' } } as PcChange,
    ], roster, npcRoster, theme, true)

    expect(refusals).toEqual([])
    expect(tx.character.update.mock.calls[0][0].data.currentLocation).toBe('Anywhere')
  })

  it('allows a move into a place that has no row yet', async () => {
    // The fiction inventing a location right now has no row to carry a gate.
    const roster = [character({ corruption: 5 })]
    tx.location.findUnique.mockResolvedValue(null)

    const { gateRefusals: refusals } = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'A Nameless Hollow' } } as PcChange,
    ], roster, npcRoster, theme, true)

    expect(refusals).toEqual([])
  })

  it('does not write harm state when a move is refused', async () => {
    // A refusal is not an injury. Routing it through harmMessages would
    // trigger the harm/conditions write that array doubles as the flag for.
    const roster = [character({ corruption: 4, harm: 0 })]
    tx.location.findUnique.mockResolvedValue({ minCorruption: null, maxCorruption: 1 })

    await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'The High Temple' } } as PcChange,
    ], roster, npcRoster, theme, true)

    const data = tx.character.update.mock.calls[0]?.[0]?.data
    expect(data?.harm).toBeUndefined()
    expect(data?.conditions).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Condition entry gate (#206)
// ---------------------------------------------------------------------------
// Same boundary discipline as the corruption gate above, but keyed on the
// destination's own conditionScore/isContested rather than a party's
// corruption — and, unlike corruption, independent of any theme, so these
// use noTheme throughout to pin that a RUINED/ABANDONED location refuses
// entry regardless of whether the campaign even has a corruption theme.

describe('applyCharacterChanges — condition entry gate', () => {
  it('refuses a move into a RUINED location', async () => {
    const roster = [character({ corruption: 0 })]
    tx.location.findUnique.mockResolvedValue({ minCorruption: null, maxCorruption: null, conditionScore: 10, isContested: false })

    const { gateRefusals: refusals } = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'The Shattered Keep' } } as PcChange,
    ], roster, npcRoster, noTheme, true)

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toContain('The Shattered Keep')
    const data = tx.character.update.mock.calls[0]?.[0]?.data
    expect(data?.currentLocation).toBeUndefined()
  })

  it('refuses a move into an ABANDONED location', async () => {
    const roster = [character({ corruption: 0 })]
    tx.location.findUnique.mockResolvedValue({ minCorruption: null, maxCorruption: null, conditionScore: 0, isContested: false })

    const { gateRefusals: refusals } = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'The Sunken Hollow' } } as PcChange,
    ], roster, npcRoster, noTheme, true)

    expect(refusals).toHaveLength(1)
  })

  it('applies with no corruption theme active — condition gating is theme-independent', async () => {
    const roster = [character({ corruption: 0 })]
    tx.location.findUnique.mockResolvedValue({ minCorruption: null, maxCorruption: null, conditionScore: 5, isContested: false })

    const { gateRefusals: refusals } = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'A Ruin' } } as PcChange,
    ], roster, npcRoster, noTheme, true)

    expect(refusals).toHaveLength(1)
  })

  it('allows a move into a DAMAGED (or better) location', async () => {
    const roster = [character({ corruption: 0 })]
    tx.location.findUnique.mockResolvedValue({ minCorruption: null, maxCorruption: null, conditionScore: 40, isContested: false })

    const { gateRefusals: refusals } = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'The Old Quarter' } } as PcChange,
    ], roster, npcRoster, noTheme, true)

    expect(refusals).toEqual([])
    expect(tx.character.update.mock.calls[0][0].data.currentLocation).toBe('The Old Quarter')
  })

  it('never checks a gate when the change is not a move', async () => {
    const roster = [character({ corruption: 0 })]
    await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { harm_damage: 1 } } as PcChange,
    ], roster, npcRoster, noTheme, true)
    expect(tx.location.findUnique).not.toHaveBeenCalled()
  })

  it('allows the move when the location has no condition data (matches undiscovered-row default)', async () => {
    const roster = [character({ corruption: 0 })]
    tx.location.findUnique.mockResolvedValue({ minCorruption: null, maxCorruption: null })

    const { gateRefusals: refusals } = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'Somewhere' } } as PcChange,
    ], roster, npcRoster, noTheme, true)

    expect(refusals).toEqual([])
  })

  it('allows the move when the gate lookup fails', async () => {
    const roster = [character({ corruption: 0 })]
    tx.location.findUnique.mockRejectedValue(new Error('db down'))

    const { gateRefusals: refusals } = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'Anywhere' } } as PcChange,
    ], roster, npcRoster, noTheme, true)

    expect(refusals).toEqual([])
  })

  it('checks condition before corruption, so a RUINED gated location refuses on condition first', async () => {
    const roster = [character({ corruption: 0 })]
    const localTheme = vi.fn().mockResolvedValue({ name: 'the Rot', stages: ['marked'] })
    tx.location.findUnique.mockResolvedValue({ minCorruption: 5, maxCorruption: null, conditionScore: 10, isContested: false })

    const { gateRefusals: refusals } = await applyCharacterChanges(tx as any, 'camp1', 3, [
      { character_name_or_id: 'char1', changes: { location: 'The Fallen Sanctum' } } as PcChange,
    ], roster, npcRoster, localTheme, true)

    expect(refusals).toHaveLength(1)
    // The corruption theme lookup never had to run — condition refused first.
    expect(localTheme).not.toHaveBeenCalled()
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
    ], roster, npcRoster, noTheme, true)

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
    ], roster, npcRoster, noTheme, true)

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
    ], roster, npcRoster, noTheme, true)

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
    ], roster, npcRoster, noTheme, true)

    const data = tx.character.update.mock.calls[0][0].data
    const invented = data.conditions.conditions.find((c: any) => c.name === 'Moonstruck')
    expect(invented.rollModifier).toBe(-1)
    expect(invented.harmPerScene).toBeUndefined()
  })
})
