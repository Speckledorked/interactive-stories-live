import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyLocationChanges, resolveOrCreateLocationId, LocationChange } from '../locations'

const makeTx = () => ({
  location: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async (_args: any) => ({})),
    create: vi.fn(async ({ data }: any) => ({ id: 'new-loc', ...data })),
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

describe('resolveOrCreateLocationId', () => {
  it('returns null for a blank/missing name without touching the DB', async () => {
    expect(await resolveOrCreateLocationId(tx as any, 'camp1', '', true)).toBeNull()
    expect(await resolveOrCreateLocationId(tx as any, 'camp1', undefined, true)).toBeNull()
    expect(tx.location.findFirst).not.toHaveBeenCalled()
  })

  it('resolves to an existing location, matching case/whitespace-insensitively', async () => {
    tx.location.findFirst.mockResolvedValue({ id: 'loc1', isDiscovered: true })
    const id = await resolveOrCreateLocationId(tx as any, 'camp1', '  the docks  ', true)
    expect(tx.location.findFirst).toHaveBeenCalledWith({
      where: { campaignId: 'camp1', name: { equals: 'the docks', mode: 'insensitive' } },
    })
    expect(id).toBe('loc1')
  })

  it('creates a new location when nothing matches, and returns its id', async () => {
    tx.location.findFirst.mockResolvedValue(null)
    const id = await resolveOrCreateLocationId(tx as any, 'camp1', 'The Rookery', true)
    expect(tx.location.create).toHaveBeenCalledWith({
      data: { campaignId: 'camp1', name: 'The Rookery', isDiscovered: true },
    })
    expect(id).toBe('new-loc')
  })

  it('creates an offscreen-introduced location as undiscovered', async () => {
    tx.location.findFirst.mockResolvedValue(null)
    await resolveOrCreateLocationId(tx as any, 'camp1', 'The Rookery', false)
    expect(tx.location.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isDiscovered: false }) })
    )
  })

  it('reveals an existing undiscovered location on a live scene', async () => {
    tx.location.findFirst.mockResolvedValue({ id: 'loc1', isDiscovered: false })
    await resolveOrCreateLocationId(tx as any, 'camp1', 'The Rookery', true)
    expect(tx.location.update).toHaveBeenCalledWith({ where: { id: 'loc1' }, data: { isDiscovered: true } })
  })

  it('does not reveal an existing undiscovered location from an offscreen update', async () => {
    tx.location.findFirst.mockResolvedValue({ id: 'loc1', isDiscovered: false })
    await resolveOrCreateLocationId(tx as any, 'camp1', 'The Rookery', false)
    expect(tx.location.update).not.toHaveBeenCalled()
  })

  it('swallows a concurrent-write failure rather than throwing, returning null', async () => {
    tx.location.findFirst.mockRejectedValue(new Error('connection reset'))
    const id = await resolveOrCreateLocationId(tx as any, 'camp1', 'The Rookery', true)
    expect(id).toBeNull()
  })
})
