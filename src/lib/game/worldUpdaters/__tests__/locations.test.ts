import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyLocationChanges, autoRegisterLocationsFromMovement, LocationChange, PcChangeForMovement } from '../locations'

const makeTx = () => ({
  location: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => ({})),
    upsert: vi.fn(async () => ({})),
  },
})

let tx: ReturnType<typeof makeTx>
beforeEach(() => {
  tx = makeTx()
})

describe('applyLocationChanges', () => {
  it('creates a brand-new location as discovered when the scene is live', async () => {
    tx.location.findUnique.mockResolvedValue(null)
    await applyLocationChanges(tx as any, 'camp1', [
      { name: 'The Drowned Market', description: 'A flooded bazaar.' } as LocationChange,
    ], true)

    expect(tx.location.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: 'camp1',
        name: 'The Drowned Market',
        description: 'A flooded bazaar.',
        isDiscovered: true,
      }),
    })
  })

  it('creates an offscreen-introduced location as undiscovered', async () => {
    tx.location.findUnique.mockResolvedValue(null)
    await applyLocationChanges(tx as any, 'camp1', [{ name: 'Hidden Vault' } as LocationChange], false)
    expect(tx.location.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ isDiscovered: false }),
    })
  })

  it('fills in description only if the existing row has none — never overwrites', async () => {
    tx.location.findUnique.mockResolvedValue({ id: 'loc1', description: 'Already described.', locationType: null, gmNotes: null, isDiscovered: true })
    await applyLocationChanges(tx as any, 'camp1', [
      { name: 'The Docks', description: 'A new description the AI made up.' } as LocationChange,
    ], true)
    expect(tx.location.update).not.toHaveBeenCalled()
  })

  it('reveals an existing undiscovered location when touched by a live scene', async () => {
    tx.location.findUnique.mockResolvedValue({ id: 'loc1', description: 'x', locationType: 'town', gmNotes: null, isDiscovered: false })
    await applyLocationChanges(tx as any, 'camp1', [{ name: 'The Docks' } as LocationChange], true)
    expect(tx.location.update).toHaveBeenCalledWith({ where: { id: 'loc1' }, data: { isDiscovered: true } })
  })

  it('does not reveal a location from an offscreen background update', async () => {
    tx.location.findUnique.mockResolvedValue({ id: 'loc1', description: 'x', locationType: 'town', gmNotes: null, isDiscovered: false })
    await applyLocationChanges(tx as any, 'camp1', [{ name: 'The Docks' } as LocationChange], false)
    expect(tx.location.update).not.toHaveBeenCalled()
  })
})

describe('autoRegisterLocationsFromMovement', () => {
  it('upserts a location for every pc_change carrying a location', async () => {
    const pcChanges: PcChangeForMovement[] = [
      { character_name_or_id: 'Jason', changes: { location: 'The Rookery' } } as PcChangeForMovement,
    ]
    await autoRegisterLocationsFromMovement(tx as any, 'camp1', pcChanges, true)
    expect(tx.location.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId_name: { campaignId: 'camp1', name: 'The Rookery' } },
        create: expect.objectContaining({ name: 'The Rookery', isDiscovered: true }),
        update: { isDiscovered: true },
      })
    )
  })

  it('skips pc_changes with no location', async () => {
    const pcChanges: PcChangeForMovement[] = [{ character_name_or_id: 'Jason', changes: {} } as PcChangeForMovement]
    await autoRegisterLocationsFromMovement(tx as any, 'camp1', pcChanges, true)
    expect(tx.location.upsert).not.toHaveBeenCalled()
  })

  it('does not force-reveal on an offscreen update (empty update payload)', async () => {
    const pcChanges: PcChangeForMovement[] = [
      { character_name_or_id: 'Jason', changes: { location: 'The Rookery' } } as PcChangeForMovement,
    ]
    await autoRegisterLocationsFromMovement(tx as any, 'camp1', pcChanges, false)
    expect(tx.location.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }))
  })

  it('swallows a concurrent-write failure rather than throwing', async () => {
    tx.location.upsert.mockRejectedValue(new Error('unique constraint'))
    const pcChanges: PcChangeForMovement[] = [
      { character_name_or_id: 'Jason', changes: { location: 'The Rookery' } } as PcChangeForMovement,
    ]
    await expect(autoRegisterLocationsFromMovement(tx as any, 'camp1', pcChanges, true)).resolves.toBeUndefined()
  })
})
