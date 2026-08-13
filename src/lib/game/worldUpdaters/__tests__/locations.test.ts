import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyLocationChanges, resolveOrCreateLocationId, LocationChange } from '../locations'

// #235: both writers now fetch the campaign's full location roster once
// (findMany) and resolve identity in-memory via the shared exact ->
// confident-fuzzy -> ambiguous resolver, instead of a per-call findFirst.
const makeTx = () => ({
  location: {
    findMany: vi.fn(),
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
    tx.location.findMany.mockResolvedValue([])
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
    tx.location.findMany.mockResolvedValue([])
    // Carries a description so it clears the is_new guard — this test is
    // about the fog-of-war rule, not about bare-name mentions.
    await applyLocationChanges(tx as any, 'camp1', [{ name: 'Hidden Vault', description: 'Sealed for an age.' } as LocationChange], false)
    expect(tx.location.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ isDiscovered: false }),
    })
  })

  it('fills in description only if the existing row has none — never overwrites', async () => {
    tx.location.findMany.mockResolvedValue([
      { id: 'loc1', name: 'The Docks', description: 'Already described.', locationType: null, gmNotes: null, isDiscovered: true },
    ])
    await applyLocationChanges(tx as any, 'camp1', [
      { name: 'The Docks', description: 'A new description the AI made up.' } as LocationChange,
    ], true)
    expect(tx.location.update).not.toHaveBeenCalled()
  })

  it('reveals an existing undiscovered location when touched by a live scene', async () => {
    tx.location.findMany.mockResolvedValue([
      { id: 'loc1', name: 'The Docks', description: 'x', locationType: 'town', gmNotes: null, isDiscovered: false },
    ])
    await applyLocationChanges(tx as any, 'camp1', [{ name: 'The Docks' } as LocationChange], true)
    expect(tx.location.update).toHaveBeenCalledWith({ where: { id: 'loc1' }, data: { isDiscovered: true } })
  })

  it('does not reveal a location from an offscreen background update', async () => {
    tx.location.findMany.mockResolvedValue([
      { id: 'loc1', name: 'The Docks', description: 'x', locationType: 'town', gmNotes: null, isDiscovered: false },
    ])
    await applyLocationChanges(tx as any, 'camp1', [{ name: 'The Docks' } as LocationChange], false)
    expect(tx.location.update).not.toHaveBeenCalled()
  })

  it('reports a WorldChange when locationType is set for the first time (#175)', async () => {
    tx.location.findMany.mockResolvedValue([
      { id: 'loc1', name: 'The Docks', description: 'x', locationType: null, gmNotes: null, isDiscovered: true },
    ])
    const result = await applyLocationChanges(tx as any, 'camp1', [
      { name: 'The Docks', location_type: 'harbor' } as LocationChange,
    ], true)
    expect(result.worldChanges).toEqual([
      expect.objectContaining({
        campaignId: 'camp1', entityType: 'LOCATION', entityId: 'loc1', field: 'locationType',
        previousValue: '(unknown)', newValue: 'harbor', origin: 'sceneResolution',
      }),
    ])
  })

  it('reports no WorldChange for a discovery-only reveal', async () => {
    tx.location.findMany.mockResolvedValue([
      { id: 'loc1', name: 'The Docks', description: 'x', locationType: 'town', gmNotes: null, isDiscovered: false },
    ])
    const result = await applyLocationChanges(tx as any, 'camp1', [{ name: 'The Docks' } as LocationChange], true)
    expect(result.worldChanges).toEqual([])
  })

  it('creates only one row for two location_changes entries naming the same brand-new place in one batch', async () => {
    tx.location.findMany.mockResolvedValue([])
    await applyLocationChanges(tx as any, 'camp1', [
      { name: 'The Sunken Vault', is_new: true } as LocationChange,
      { name: 'The Sunken Vault', gm_notes_append: 'Smells of brine.' } as LocationChange,
    ], true)
    expect(tx.location.create).toHaveBeenCalledTimes(1)
    expect(tx.location.update).toHaveBeenCalledTimes(1)
  })
})

describe('resolveOrCreateLocationId', () => {
  it('returns null for a blank/missing name without touching the DB', async () => {
    expect(await resolveOrCreateLocationId(tx as any, 'camp1', '', true)).toBeNull()
    expect(await resolveOrCreateLocationId(tx as any, 'camp1', undefined, true)).toBeNull()
    expect(tx.location.findMany).not.toHaveBeenCalled()
  })

  it('resolves to an existing location, matching case/whitespace-insensitively', async () => {
    tx.location.findMany.mockResolvedValue([{ id: 'loc1', name: 'the docks', isDiscovered: true }])
    const id = await resolveOrCreateLocationId(tx as any, 'camp1', '  The Docks  ', true)
    expect(tx.location.findMany).toHaveBeenCalledWith({ where: { campaignId: 'camp1' } })
    expect(id).toBe('loc1')
  })

  it('resolves a trivial AI-side typo to the existing location instead of minting a near-duplicate', async () => {
    tx.location.findMany.mockResolvedValue([{ id: 'loc1', name: 'Ashenmoor', isDiscovered: true }])
    const id = await resolveOrCreateLocationId(tx as any, 'camp1', 'Ashenmoors', true)
    expect(id).toBe('loc1')
    expect(tx.location.create).not.toHaveBeenCalled()
  })

  it('creates a new location when nothing matches, and returns its id', async () => {
    tx.location.findMany.mockResolvedValue([])
    const id = await resolveOrCreateLocationId(tx as any, 'camp1', 'The Rookery', true)
    expect(tx.location.create).toHaveBeenCalledWith({
      data: { campaignId: 'camp1', name: 'The Rookery', isDiscovered: true },
    })
    expect(id).toBe('new-loc')
  })

  it('creates an offscreen-introduced location as undiscovered', async () => {
    tx.location.findMany.mockResolvedValue([])
    await resolveOrCreateLocationId(tx as any, 'camp1', 'The Rookery', false)
    expect(tx.location.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isDiscovered: false }) })
    )
  })

  it('reveals an existing undiscovered location on a live scene', async () => {
    tx.location.findMany.mockResolvedValue([{ id: 'loc1', name: 'The Rookery', isDiscovered: false }])
    await resolveOrCreateLocationId(tx as any, 'camp1', 'The Rookery', true)
    expect(tx.location.update).toHaveBeenCalledWith({ where: { id: 'loc1' }, data: { isDiscovered: true } })
  })

  it('does not reveal an existing undiscovered location from an offscreen update', async () => {
    tx.location.findMany.mockResolvedValue([{ id: 'loc1', name: 'The Rookery', isDiscovered: false }])
    await resolveOrCreateLocationId(tx as any, 'camp1', 'The Rookery', false)
    expect(tx.location.update).not.toHaveBeenCalled()
  })

  it('swallows a concurrent-write failure rather than throwing, returning null', async () => {
    tx.location.findMany.mockRejectedValue(new Error('connection reset'))
    const id = await resolveOrCreateLocationId(tx as any, 'camp1', 'The Rookery', true)
    expect(id).toBeNull()
  })

  // #235: the actual audit fix — an ambiguous match (two existing rows the
  // reported name could plausibly mean) now fails closed instead of
  // picking one via a bare, order-unguaranteed findFirst, or minting a
  // third near-duplicate row.
  it('fails closed on an ambiguous match instead of guessing or minting a duplicate', async () => {
    tx.location.findMany.mockResolvedValue([
      { id: 'loc1', name: 'The Docks', isDiscovered: true },
      { id: 'loc2', name: 'the docks', isDiscovered: true },
    ])
    const id = await resolveOrCreateLocationId(tx as any, 'camp1', 'The Docks', true)
    expect(id).toBeNull()
    expect(tx.location.create).not.toHaveBeenCalled()
    expect(tx.location.update).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// One place, one row
// ---------------------------------------------------------------------------
// applyLocationChanges used findUnique on the campaignId_name compound key,
// which Postgres matches case-sensitively, while resolveOrCreateLocationId
// matched case-insensitively. The two writers for the same table disagreed
// about what counts as the same place, so a re-spelling minted a duplicate
// and later lookups picked whichever row came back first. Weather,
// isContested, faction territory and the corruption gates all hang off
// Location, so a split row strands the party on one copy while the state
// they care about lives on the other.

describe('applyLocationChanges — location identity', () => {
  it('matches an existing location regardless of case, instead of duplicating it', async () => {
    tx.location.findMany.mockResolvedValue([
      { id: 'loc1', name: 'The Docks', description: 'x', locationType: 'town', gmNotes: null, isDiscovered: true },
    ])

    await applyLocationChanges(tx as any, 'camp1', [
      { name: 'the docks', gm_notes_append: 'Smugglers active.' } as LocationChange,
    ], true)

    expect(tx.location.create).not.toHaveBeenCalled()
    expect(tx.location.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'loc1' } })
    )
  })

  it('fetches the full campaign roster once, the same way character movement does', async () => {
    tx.location.findMany.mockResolvedValue([])
    await applyLocationChanges(tx as any, 'camp1', [
      { name: 'The Docks', description: 'x' } as LocationChange,
    ], true)

    expect(tx.location.findMany).toHaveBeenCalledWith({ where: { campaignId: 'camp1' } })
  })

  it('fails closed rather than guessing when two existing rows both plausibly match', async () => {
    tx.location.findMany.mockResolvedValue([
      { id: 'loc1', name: 'The Docks', description: 'x', locationType: 'town', gmNotes: null, isDiscovered: true },
      { id: 'loc2', name: 'the docks', description: 'y', locationType: 'harbor', gmNotes: null, isDiscovered: true },
    ])

    await applyLocationChanges(tx as any, 'camp1', [
      { name: 'The Docks', description: 'A new description the AI made up.' } as LocationChange,
    ], true)

    expect(tx.location.create).not.toHaveBeenCalled()
    expect(tx.location.update).not.toHaveBeenCalled()
  })
})

describe('applyLocationChanges — is_new guards row creation', () => {
  it('mints a row for a genuinely new place', async () => {
    tx.location.findMany.mockResolvedValue([])
    await applyLocationChanges(tx as any, 'camp1', [
      { name: 'The Sunken Vault', is_new: true } as LocationChange,
    ], true)
    expect(tx.location.create).toHaveBeenCalled()
  })

  it('mints a row for an unknown place that carries a description', async () => {
    tx.location.findMany.mockResolvedValue([])
    await applyLocationChanges(tx as any, 'camp1', [
      { name: 'The Sunken Vault', description: 'Flooded and forgotten.' } as LocationChange,
    ], true)
    expect(tx.location.create).toHaveBeenCalled()
  })

  it('skips a bare unknown name rather than minting a row from a passing mention', async () => {
    // is_new was declared in the schema and prompted for, but never read —
    // so any unresolvable name created something. Same guard NPCs and
    // factions already use.
    tx.location.findMany.mockResolvedValue([])
    await applyLocationChanges(tx as any, 'camp1', [
      { name: 'somewhere north' } as LocationChange,
    ], true)
    expect(tx.location.create).not.toHaveBeenCalled()
  })
})

describe('applyLocationChanges — corruption gates on the create path (#83)', () => {
  it('carries reported gates onto a newly created location', async () => {
    // The update path wrote these and the create path dropped them, so a
    // location born already gated came out ungated.
    tx.location.findMany.mockResolvedValue([])
    await applyLocationChanges(tx as any, 'camp1', [
      { name: 'The High Temple', description: 'x', max_corruption: 1 } as LocationChange,
    ], true)

    expect(tx.location.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ maxCorruption: 1, minCorruption: null }),
    })
  })
})
