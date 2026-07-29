import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyNpcChanges, NpcChange } from '../npcs'
import type { NPC, Character } from '@prisma/client'
import { uniqueConstraintError } from './testPrismaErrors'

const makeTx = () => ({
  nPC: {
    update: vi.fn(async () => ({})),
    create: vi.fn(async ({ data }: any) => ({ id: 'new-npc', ...data })),
  },
})

let tx: ReturnType<typeof makeTx>
beforeEach(() => {
  tx = makeTx()
})

const npc = (over: Partial<NPC> = {}): NPC =>
  ({
    id: 'npc1', name: 'Lord Kessler', gmNotes: null, description: 'A cruel noble.',
    goals: null, harm: 0, isAlive: true, isDiscovered: false,
    ...over,
  } as NPC)

const character = (over: Partial<Character> = {}): Character =>
  ({ id: 'char1', name: 'Jason', equipment: { weapon: 'longsword' }, inventory: { items: [] }, ...over } as Character)

describe('applyNpcChanges — resolving and updating', () => {
  it('updates an existing NPC and reports it as involved', async () => {
    const roster = [npc()]
    const result = await applyNpcChanges(
      tx as any, 'camp1',
      [{ npc_name_or_id: 'Lord Kessler', changes: { goals: 'Seize the throne' } } as NpcChange],
      roster, [], true
    )
    expect(tx.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1' },
      data: expect.objectContaining({ goals: 'Seize the throne', goalProgress: 0 }),
    })
    expect(result.involvedNpcIds).toEqual(['npc1'])
  })

  it('reveals an undiscovered NPC only on a live scene, not an offscreen update', async () => {
    const roster = [npc({ isDiscovered: false })]
    await applyNpcChanges(tx as any, 'camp1', [{ npc_name_or_id: 'npc1', changes: {} } as NpcChange], roster, [], false)
    expect(tx.nPC.update).not.toHaveBeenCalled()
  })

  it('does not overwrite an existing description with a new one', async () => {
    const roster = [npc({ description: 'Already has one.', isDiscovered: true })]
    await applyNpcChanges(tx as any, 'camp1', [
      { npc_name_or_id: 'npc1', changes: { description: 'A different one from the AI.' } } as NpcChange,
    ], roster, [], true)
    expect(tx.nPC.update).not.toHaveBeenCalled()
  })
})

describe('applyNpcChanges — harm and weapon bonus', () => {
  it('applies harm damage without an attacker', async () => {
    const roster = [npc({ harm: 0 })]
    await applyNpcChanges(tx as any, 'camp1', [
      { npc_name_or_id: 'npc1', changes: { harm_damage: 2 } } as NpcChange,
    ], roster, [], true)
    expect(tx.nPC.update).toHaveBeenCalledWith({ where: { id: 'npc1' }, data: expect.objectContaining({ harm: 2 }) })
  })

  it("folds the attacker's weapon bonus into harm damage when resolvable", async () => {
    const roster = [npc({ harm: 0 })]
    const characters = [character({ equipment: { weapon: 'greatsword' }, inventory: { items: [{ id: 'w1', name: 'greatsword', damageBonus: 2 }] } })]

    await applyNpcChanges(tx as any, 'camp1', [
      { npc_name_or_id: 'npc1', changes: { harm_damage: 1, harm_damage_dealt_by: 'Jason' } } as NpcChange,
    ], roster, characters, true)

    expect(tx.nPC.update).toHaveBeenCalledWith({ where: { id: 'npc1' }, data: expect.objectContaining({ harm: 3 }) })
  })

  it('marks the NPC dead once harm reaches 6', async () => {
    const roster = [npc({ harm: 5 })]
    await applyNpcChanges(tx as any, 'camp1', [
      { npc_name_or_id: 'npc1', changes: { harm_damage: 3 } } as NpcChange,
    ], roster, [], true)
    expect(tx.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1' },
      data: expect.objectContaining({ harm: 6, isAlive: false }),
    })
  })
})

describe('applyNpcChanges — stub creation', () => {
  it('creates a stub NPC when is_new is set and nothing matches', async () => {
    const result = await applyNpcChanges(tx as any, 'camp1', [
      { npc_name_or_id: 'A Mysterious Stranger', is_new: true, changes: { description: 'Cloaked, silent.' } } as NpcChange,
    ], [], [], true)

    expect(tx.nPC.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ campaignId: 'camp1', name: 'A Mysterious Stranger', isDiscovered: true }),
    })
    expect(result.involvedNpcIds).toEqual(['new-npc'])
  })

  it('creates an offscreen-introduced NPC as undiscovered', async () => {
    await applyNpcChanges(tx as any, 'camp1', [
      { npc_name_or_id: 'A Distant Rival', is_new: true, changes: {} } as NpcChange,
    ], [], [], false)
    expect(tx.nPC.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isDiscovered: false }) }))
  })

  it('does not create a stub for an unresolved name with no is_new/description hint', async () => {
    await applyNpcChanges(tx as any, 'camp1', [
      { npc_name_or_id: 'Someone Vague', changes: {} } as NpcChange,
    ], [], [], true)
    expect(tx.nPC.create).not.toHaveBeenCalled()
  })

  it('a stub created mid-batch resolves for a later change referencing the same name', async () => {
    const npcsForResolution: NPC[] = []
    await applyNpcChanges(tx as any, 'camp1', [
      { npc_name_or_id: 'A Mysterious Stranger', is_new: true, changes: { description: 'Cloaked.' } } as NpcChange,
      { npc_name_or_id: 'A Mysterious Stranger', changes: { goals: 'Vanish before dawn' } } as NpcChange,
    ], npcsForResolution, [], true)

    expect(tx.nPC.create).toHaveBeenCalledTimes(1)
    expect(tx.nPC.update).toHaveBeenCalledWith({
      where: { id: 'new-npc' },
      data: expect.objectContaining({ goals: 'Vanish before dawn' }),
    })
  })

  // Phase 1b added a real DB uniqueness constraint on (campaignId, name).
  // resolveEntityByNameOrId already confirmed no existing NPC matches before
  // this create runs, so this should be unreachable in practice — but this
  // create shares a transaction with every other domain's changes for the
  // scene, so a rare collision must degrade, not take the whole scene down.
  it('skips the stub and does not throw when the name collides at write time', async () => {
    tx.nPC.create.mockRejectedValueOnce(uniqueConstraintError('NPC_campaignId_name_lower_key'))

    const result = await applyNpcChanges(tx as any, 'camp1', [
      { npc_name_or_id: 'A Mysterious Stranger', is_new: true, changes: { description: 'Cloaked.' } } as NpcChange,
    ], [], [], true)

    expect(result.involvedNpcIds).toEqual([])
  })

  it('still throws a non-uniqueness error from stub creation', async () => {
    tx.nPC.create.mockRejectedValueOnce(new Error('connection lost'))
    await expect(applyNpcChanges(tx as any, 'camp1', [
      { npc_name_or_id: 'A Mysterious Stranger', is_new: true, changes: { description: 'Cloaked.' } } as NpcChange,
    ], [], [], true)).rejects.toThrow('connection lost')
  })

  it('does not create a duplicate stub when the name is an ambiguous fuzzy match', async () => {
    const roster = [npc({ id: 'n1', name: 'Manston' }), npc({ id: 'n2', name: 'Marlton' })]
    await applyNpcChanges(tx as any, 'camp1', [
      { npc_name_or_id: 'Marston', is_new: true, changes: { description: 'x' } } as NpcChange,
    ], roster, [], true)
    expect(tx.nPC.create).not.toHaveBeenCalled()
    expect(tx.nPC.update).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// NPC harm recovery (#71)
// ---------------------------------------------------------------------------
// NPC harm used to be a one-way ratchet: damage landed and there was no
// path back down at all, so a wounded-but-living NPC could only ever get
// worse. PCs get five recovery branches; this is the NPC counterpart.

describe('applyNpcChanges — harm recovery (#71)', () => {
  it('reduces harm when healing is reported', async () => {
    const roster = [npc({ harm: 4 })]
    await applyNpcChanges(
      tx as any, 'camp1',
      [{ npc_name_or_id: 'Lord Kessler', changes: { harm_healing: 3 } } as NpcChange],
      roster, [], true
    )
    expect(tx.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1' },
      data: expect.objectContaining({ harm: 1 }),
    })
  })

  it('nets damage and healing reported in the same batch', async () => {
    const roster = [npc({ harm: 0 })]
    await applyNpcChanges(
      tx as any, 'camp1',
      [{ npc_name_or_id: 'Lord Kessler', changes: { harm_damage: 4, harm_healing: 2 } } as NpcChange],
      roster, [], true
    )
    const data = (tx.nPC.update as any).mock.calls[0][0].data
    expect(data.harm).toBe(2)
  })

  it('does not resurrect an NPC already taken out', async () => {
    // Recovering from a wound is not resurrection.
    const roster = [npc({ harm: 6, isAlive: false })]
    await applyNpcChanges(
      tx as any, 'camp1',
      [{ npc_name_or_id: 'Lord Kessler', changes: { harm_healing: 6 } } as NpcChange],
      roster, [], true
    )
    const data = (tx.nPC.update as any).mock.calls[0][0].data
    expect(data.isAlive).toBeUndefined()
  })

  it('leaves a living NPC alive after healing', async () => {
    const roster = [npc({ harm: 5, isAlive: true })]
    await applyNpcChanges(
      tx as any, 'camp1',
      [{ npc_name_or_id: 'Lord Kessler', changes: { harm_healing: 2 } } as NpcChange],
      roster, [], true
    )
    const data = (tx.nPC.update as any).mock.calls[0][0].data
    expect(data.harm).toBe(3)
    expect(data.isAlive).toBe(true)
  })

  it('ignores a zero or absent healing value', async () => {
    // The fixture is undiscovered, so a live scene still writes
    // isDiscovered — the invariant under test is that harm is untouched.
    const roster = [npc({ harm: 3 })]
    await applyNpcChanges(
      tx as any, 'camp1',
      [{ npc_name_or_id: 'Lord Kessler', changes: { harm_healing: 0 } } as NpcChange],
      roster, [], true
    )
    const data = (tx.nPC.update as any).mock.calls[0][0].data
    expect(data.harm).toBeUndefined()
  })
})
