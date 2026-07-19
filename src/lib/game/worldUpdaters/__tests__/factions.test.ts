import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyFactionChanges, FactionChange } from '../factions'
import type { Faction } from '@prisma/client'

const makeTx = () => ({
  faction: {
    update: vi.fn(async () => ({})),
    create: vi.fn(async ({ data }: any) => ({ id: 'new-faction', ...data })),
  },
})

let tx: ReturnType<typeof makeTx>
beforeEach(() => {
  tx = makeTx()
})

const faction = (over: Partial<Faction> = {}): Faction =>
  ({
    id: 'f1', name: 'The Ashen Circle', currentPlan: null, threatLevel: 1,
    goal: 'ENRICH', leaderCharacterId: null, gmNotes: '', isDiscovered: false,
    ...over,
  } as Faction)

describe('applyFactionChanges — resolving and updating', () => {
  it('updates an existing faction and reports it as involved', async () => {
    const roster = [faction()]
    const result = await applyFactionChanges(tx as any, 'camp1', [
      { faction_name_or_id: 'The Ashen Circle', changes: { current_plan: 'Buy the harbor guard.' } } as FactionChange,
    ], roster, true)

    expect(tx.faction.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: expect.objectContaining({ currentPlan: 'Buy the harbor guard.' }),
    })
    expect(result.involvedFactionIds).toEqual(['f1'])
  })

  it('maps a threat_level string onto the numeric field', async () => {
    const roster = [faction({ isDiscovered: true })]
    await applyFactionChanges(tx as any, 'camp1', [
      { faction_name_or_id: 'f1', changes: { threat_level: 'HIGH' } } as FactionChange,
    ], roster, true)
    expect(tx.faction.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { threatLevel: 3 } })
  })

  it('only honors an AI-set goal for a player-led faction', async () => {
    const roster = [faction({ leaderCharacterId: null, isDiscovered: true })]
    await applyFactionChanges(tx as any, 'camp1', [
      { faction_name_or_id: 'f1', changes: { goal: 'DESTABILIZE_RIVAL' } } as FactionChange,
    ], roster, true)
    expect(tx.faction.update).not.toHaveBeenCalled()
  })

  it('honors an AI-set goal when the faction IS player-led', async () => {
    const roster = [faction({ leaderCharacterId: 'char1', isDiscovered: true })]
    await applyFactionChanges(tx as any, 'camp1', [
      { faction_name_or_id: 'f1', changes: { goal: 'DESTABILIZE_RIVAL' } } as FactionChange,
    ], roster, true)
    expect(tx.faction.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { goal: 'DESTABILIZE_RIVAL' } })
  })

  it('reveals an undiscovered faction only on a live scene', async () => {
    const roster = [faction({ isDiscovered: false })]
    await applyFactionChanges(tx as any, 'camp1', [{ faction_name_or_id: 'f1', changes: {} } as FactionChange], roster, false)
    expect(tx.faction.update).not.toHaveBeenCalled()
  })
})

describe('applyFactionChanges — stub creation', () => {
  it('creates a stub faction when is_new is set and nothing matches', async () => {
    const result = await applyFactionChanges(tx as any, 'camp1', [
      { faction_name_or_id: 'The Gilded Hand', is_new: true, changes: { description: 'Merchant cabal.' } } as FactionChange,
    ], [], true)

    expect(tx.faction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ campaignId: 'camp1', name: 'The Gilded Hand', isDiscovered: true }),
    })
    expect(result.involvedFactionIds).toEqual(['new-faction'])
  })

  it('does not create a stub for an unresolved name with no is_new/description hint', async () => {
    await applyFactionChanges(tx as any, 'camp1', [
      { faction_name_or_id: 'Someone Vague', changes: {} } as FactionChange,
    ], [], true)
    expect(tx.faction.create).not.toHaveBeenCalled()
  })

  it('a stub created mid-batch resolves for a later change referencing the same name', async () => {
    const factionsForResolution: Faction[] = []
    await applyFactionChanges(tx as any, 'camp1', [
      { faction_name_or_id: 'The Gilded Hand', is_new: true, changes: { description: 'x' } } as FactionChange,
      { faction_name_or_id: 'The Gilded Hand', changes: { current_plan: 'Corner the spice market' } } as FactionChange,
    ], factionsForResolution, true)

    expect(tx.faction.create).toHaveBeenCalledTimes(1)
    expect(tx.faction.update).toHaveBeenCalledWith({
      where: { id: 'new-faction' },
      data: expect.objectContaining({ currentPlan: 'Corner the spice market' }),
    })
  })

  it('does not create a duplicate stub when the name is an ambiguous fuzzy match', async () => {
    const roster = [faction({ id: 'f1', name: 'Manston Trading Co' }), faction({ id: 'f2', name: 'Marlton Trading Co' })]
    await applyFactionChanges(tx as any, 'camp1', [
      { faction_name_or_id: 'Marston Trading Co', is_new: true, changes: { description: 'x' } } as FactionChange,
    ], roster, true)
    expect(tx.faction.create).not.toHaveBeenCalled()
    expect(tx.faction.update).not.toHaveBeenCalled()
  })
})
