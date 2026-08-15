import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyQuestChanges, QuestChange } from '../quests'
import { uniqueConstraintError } from './testPrismaErrors'

vi.mock('../../questRewards', () => ({
  applyQuestRewardGrant: vi.fn(async () => ['Jason received 50 gold from completing "Clear the Warrens"']),
}))
vi.mock('../../questFailure', () => ({
  applyQuestFailureCost: vi.fn(async () => ['Jason lost standing with the quest-giver']),
}))
import { applyQuestRewardGrant } from '../../questRewards'
import { applyQuestFailureCost } from '../../questFailure'

const makeTx = () => ({
  quest: {
    findFirst: vi.fn(),
    update: vi.fn(async (_args: any) => ({})),
    // #212: status-bearing writes go through updateMany, guarded on the
    // exact status read earlier — defaults to a successful (count: 1)
    // write so every existing test's happy path is unaffected; the race
    // itself is exercised by mocking count: 0 explicitly.
    updateMany: vi.fn(async (_args: any) => ({ count: 1 })),
    create: vi.fn(async () => ({})),
  },
  // Quest-giver rosters (#75), loaded lazily and at most once per batch.
  // findUnique is the #206 condition-acquisition-gate lookup — only
  // consulted when a quest change resolves a giver NPC id.
  nPC: {
    findMany: vi.fn(async (): Promise<Array<{ id: string; name: string }>> => []),
    findUnique: vi.fn(async (): Promise<{ location: { conditionScore: number; isContested: boolean } | null } | null> => null),
  },
  faction: { findMany: vi.fn(async (): Promise<Array<{ id: string; name: string }>> => []) },
  // Corruption acquisition gate (#83) context.
  campaign: { findUnique: vi.fn(async (): Promise<{ corruptionTheme: unknown } | null> => ({ corruptionTheme: { name: 'the Rot' } })) },
  character: { findMany: vi.fn(async (): Promise<Array<{ corruption: number }>> => []) },
})

let tx: ReturnType<typeof makeTx>
beforeEach(() => {
  tx = makeTx()
  vi.mocked(applyQuestRewardGrant).mockClear()
  vi.mocked(applyQuestFailureCost).mockClear()
})

describe('applyQuestChanges — new quest', () => {
  it('registers a new quest when none exists by that name', async () => {
    tx.quest.findFirst.mockResolvedValue(null)
    const change: QuestChange = {
      name: 'Clear the Warrens',
      changes: { description: 'Rats the size of dogs.', status: 'ACTIVE' },
    } as QuestChange

    await applyQuestChanges(tx as any, 'camp1', 3, [change])

    expect(tx.quest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: 'camp1',
        name: 'Clear the Warrens',
        description: 'Rats the size of dogs.',
        status: 'ACTIVE',
      }),
    })
  })

  it('pays out a reward grant if a brand-new quest is registered already-completed', async () => {
    tx.quest.findFirst.mockResolvedValue(null)
    const change: QuestChange = {
      name: 'Clear the Warrens',
      changes: { status: 'COMPLETED', reward_grant: { gold: 50 } },
    } as QuestChange

    await applyQuestChanges(tx as any, 'camp1', 3, [change])

    // Trailing args: the quest's resolved giver faction (funds the payout
    // when the grant names no payer) and the turn, for the rarity budget.
    expect(applyQuestRewardGrant).toHaveBeenCalledWith(tx, 'camp1', 'Clear the Warrens', { gold: 50 }, null, 3)
  })

  it('skips a malformed change with no name', async () => {
    await applyQuestChanges(tx as any, 'camp1', 1, [{ changes: {} } as QuestChange])
    expect(tx.quest.create).not.toHaveBeenCalled()
    expect(tx.quest.findFirst).not.toHaveBeenCalled()
  })

  // Phase 1b's real DB uniqueness on (campaignId, name) — the findFirst
  // above already confirmed no quest by this name exists, so this should be
  // unreachable in the common case, but the create runs inside the same
  // transaction as every other domain's changes for the scene (see the
  // schema comment on Quest.objectiveKey), so a rare collision must degrade
  // rather than abort it.
  it('skips registration and does not throw when the name collides at write time', async () => {
    tx.quest.findFirst.mockResolvedValue(null)
    tx.quest.create.mockRejectedValueOnce(uniqueConstraintError('Quest_campaignId_name_lower_key'))

    await expect(applyQuestChanges(tx as any, 'camp1', 3, [
      { name: 'Clear the Warrens', changes: { description: 'Rats.', status: 'ACTIVE' } } as QuestChange,
    ])).resolves.toEqual({ worldChanges: [] })

    expect(applyQuestRewardGrant).not.toHaveBeenCalled()
  })

  it('still throws a non-uniqueness error from quest registration', async () => {
    tx.quest.findFirst.mockResolvedValue(null)
    tx.quest.create.mockRejectedValueOnce(new Error('connection lost'))
    await expect(applyQuestChanges(tx as any, 'camp1', 3, [
      { name: 'Clear the Warrens', changes: { description: 'Rats.' } } as QuestChange,
    ])).rejects.toThrow('connection lost')
  })
})

describe('applyQuestChanges — existing quest', () => {
  const existing = {
    id: 'q1', name: 'Clear the Warrens', status: 'ACTIVE', progressLog: null,
  }

  it('appends a turn-stamped progress line', async () => {
    tx.quest.findFirst.mockResolvedValue({ ...existing, progressLog: 'Turn 1: Found the entrance.' })
    await applyQuestChanges(tx as any, 'camp1', 4, [
      { name: 'Clear the Warrens', changes: { progress_append: 'Killed the nest queen.' } } as QuestChange,
    ])
    expect(tx.quest.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: expect.objectContaining({ progressLog: 'Turn 1: Found the entrance.\nTurn 4: Killed the nest queen.' }),
    })
  })

  it('pays a reward grant exactly once, the turn status first flips to COMPLETED', async () => {
    tx.quest.findFirst.mockResolvedValue({ ...existing, status: 'ACTIVE' })
    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'Clear the Warrens', changes: { status: 'COMPLETED', reward_grant: { gold: 50 } } } as QuestChange,
    ])
    expect(applyQuestRewardGrant).toHaveBeenCalledTimes(1)
  })

  it('reports a MAJOR WorldChange for a status change to COMPLETED (#175)', async () => {
    tx.quest.findFirst.mockResolvedValue({ ...existing, status: 'ACTIVE' })
    const result = await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'Clear the Warrens', changes: { status: 'COMPLETED' } } as QuestChange,
    ])
    expect(result.worldChanges).toEqual([
      expect.objectContaining({
        campaignId: 'camp1', entityType: 'QUEST', entityId: 'q1', field: 'status',
        previousValue: 'ACTIVE', newValue: 'COMPLETED', importance: 'MAJOR', origin: 'sceneResolution',
      }),
    ])
  })

  it('reports no WorldChange for a progress-append-only update', async () => {
    tx.quest.findFirst.mockResolvedValue({ ...existing, progressLog: null })
    const result = await applyQuestChanges(tx as any, 'camp1', 4, [
      { name: 'Clear the Warrens', changes: { progress_append: 'Killed the nest queen.' } } as QuestChange,
    ])
    expect(result.worldChanges).toEqual([])
  })

  it('does NOT re-pay a reward grant on a repeated report of an already-completed quest', async () => {
    tx.quest.findFirst.mockResolvedValue({ ...existing, status: 'COMPLETED' })
    await applyQuestChanges(tx as any, 'camp1', 6, [
      { name: 'Clear the Warrens', changes: { status: 'COMPLETED', reward_grant: { gold: 50 } } } as QuestChange,
    ])
    expect(applyQuestRewardGrant).not.toHaveBeenCalled()
  })

  it('#212: guards the status write on the exact status just read, not a blind update', async () => {
    tx.quest.findFirst.mockResolvedValue({ ...existing, status: 'ACTIVE' })
    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'Clear the Warrens', changes: { status: 'COMPLETED' } } as QuestChange,
    ])
    expect(tx.quest.updateMany).toHaveBeenCalledWith({
      where: { id: 'q1', status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    })
    expect(tx.quest.update).not.toHaveBeenCalled()
  })

  it('#212: does not double-grant a reward when a racing transaction already completed the quest first', async () => {
    // Simulates the real race: this transaction read the quest as ACTIVE
    // (existing.status below), but by the time it tries to write, another
    // transaction already flipped it to COMPLETED — the guarded updateMany
    // affects zero rows.
    tx.quest.findFirst.mockResolvedValue({ ...existing, status: 'ACTIVE' })
    tx.quest.updateMany.mockResolvedValueOnce({ count: 0 })

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'Clear the Warrens', changes: { status: 'COMPLETED', reward_grant: { gold: 50 } } } as QuestChange,
    ])

    expect(applyQuestRewardGrant).not.toHaveBeenCalled()
  })

  it('#212: does not double-charge a failure cost when a racing transaction already failed the quest first', async () => {
    tx.quest.findFirst.mockResolvedValue({ ...existing, status: 'ACTIVE' })
    tx.quest.updateMany.mockResolvedValueOnce({ count: 0 })

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'Clear the Warrens', changes: { status: 'FAILED' } } as QuestChange,
    ])

    expect(applyQuestFailureCost).not.toHaveBeenCalled()
  })

  it('#212: still grants the reward normally when the guarded write actually wins the race', async () => {
    tx.quest.findFirst.mockResolvedValue({ ...existing, status: 'ACTIVE' })
    tx.quest.updateMany.mockResolvedValueOnce({ count: 1 })

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'Clear the Warrens', changes: { status: 'COMPLETED', reward_grant: { gold: 50 } } } as QuestChange,
    ])

    expect(applyQuestRewardGrant).toHaveBeenCalledTimes(1)
  })

  it('sets resolvedAt when status moves to a non-ACTIVE terminal state', async () => {
    tx.quest.findFirst.mockResolvedValue({ ...existing, status: 'ACTIVE' })
    await applyQuestChanges(tx as any, 'camp1', 7, [
      { name: 'Clear the Warrens', changes: { status: 'FAILED' } } as QuestChange,
    ])
    const call = tx.quest.updateMany.mock.calls[0][0]
    expect(call.data.status).toBe('FAILED')
    expect(call.data.resolvedAt).toBeInstanceOf(Date)
  })

  it('makes no DB write when nothing actually changed', async () => {
    tx.quest.findFirst.mockResolvedValue({ ...existing, objectiveKey: 'clear-the-warrens' })
    await applyQuestChanges(tx as any, 'camp1', 8, [
      { name: 'Clear the Warrens', changes: {} } as QuestChange,
    ])
    expect(tx.quest.update).not.toHaveBeenCalled()
  })

  it('backfills the stable handle for a quest that predates it (#45)', async () => {
    // Legacy quests carry no objectiveKey and the only hook to fill one in
    // is the fiction touching the quest again — so an otherwise-no-op
    // report DOES write here, exactly once.
    tx.quest.findFirst
      .mockResolvedValueOnce({ ...existing, objectiveKey: null })
      .mockResolvedValueOnce(null) // key is unclaimed
    await applyQuestChanges(tx as any, 'camp1', 8, [
      { name: 'Clear the Warrens', changes: {} } as QuestChange,
    ])
    expect(tx.quest.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { objectiveKey: 'clear-the-warrens' },
    })
  })

  it('leaves a quest unkeyed rather than colliding with a key another holds', async () => {
    // This check is the ONLY thing keeping objectiveKey unique. The DB-level
    // unique constraint was removed because `prisma db push` — this
    // project's build command — refuses to add one without
    // --accept-data-loss, and that flag would be a standing permission to
    // drop production columns. So this test guards a real invariant, not a
    // redundant belt on top of a database braces.
    tx.quest.findFirst
      .mockResolvedValueOnce({ ...existing, objectiveKey: null })
      .mockResolvedValueOnce({ id: 'other-quest', name: 'Clear the Warrens!' })
    await applyQuestChanges(tx as any, 'camp1', 8, [
      { name: 'Clear the Warrens', changes: {} } as QuestChange,
    ])
    expect(tx.quest.update).not.toHaveBeenCalled()
  })
})

describe('applyQuestChanges — quest giver resolution (#75)', () => {
  const existing = { id: 'q1', name: 'Clear the Warrens', status: 'ACTIVE', progressLog: null, objectiveKey: 'clear-the-warrens' }

  it('links a reported giver to the real NPC row', async () => {
    tx.quest.findFirst.mockResolvedValue({ ...existing })
    tx.nPC.findMany.mockResolvedValue([{ id: 'n1', name: 'Marek Voss' }])
    tx.faction.findMany.mockResolvedValue([{ id: 'f1', name: 'Thieves Guild' }])

    await applyQuestChanges(tx as any, 'camp1', 4, [
      { name: 'Clear the Warrens', changes: { given_by: 'Marek Voss' } } as QuestChange,
    ])

    const data = tx.quest.update.mock.calls[0][0].data
    expect(data).toMatchObject({ givenBy: 'Marek Voss', givenByNpcId: 'n1', givenByFactionId: null })
  })

  it('keeps an unresolvable giver as display text and links nothing', async () => {
    tx.quest.findFirst.mockResolvedValue({ ...existing })
    tx.nPC.findMany.mockResolvedValue([])
    tx.faction.findMany.mockResolvedValue([])

    await applyQuestChanges(tx as any, 'camp1', 4, [
      { name: 'Clear the Warrens', changes: { given_by: 'A hooded stranger' } } as QuestChange,
    ])

    const data = tx.quest.update.mock.calls[0][0].data
    expect(data).toMatchObject({ givenBy: 'A hooded stranger', givenByNpcId: null, givenByFactionId: null })
  })

  it('fetches the giver rosters at most once for a whole batch', async () => {
    tx.quest.findFirst.mockResolvedValue({ ...existing })
    tx.nPC.findMany.mockResolvedValue([{ id: 'n1', name: 'Marek Voss' }])
    tx.faction.findMany.mockResolvedValue([])

    await applyQuestChanges(tx as any, 'camp1', 4, [
      { name: 'Clear the Warrens', changes: { given_by: 'Marek Voss' } } as QuestChange,
      { name: 'Clear the Warrens', changes: { given_by: 'Marek Voss' } } as QuestChange,
    ])

    expect(tx.nPC.findMany).toHaveBeenCalledTimes(1)
    expect(tx.faction.findMany).toHaveBeenCalledTimes(1)
  })

  it('never queries the rosters for a batch that names no giver', async () => {
    tx.quest.findFirst.mockResolvedValue({ ...existing })
    await applyQuestChanges(tx as any, 'camp1', 4, [
      { name: 'Clear the Warrens', changes: { progress_append: 'Found the nest.' } } as QuestChange,
    ])
    expect(tx.nPC.findMany).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Corruption acquisition gate (#83)
// ---------------------------------------------------------------------------
// The safety property: gates apply at ACQUISITION only. Marks are
// irreversible, so revoking an active quest — or blocking its completion —
// would strand a party mid-job with no way back.

describe('applyQuestChanges — corruption acquisition gate', () => {
  const gated = (over: Record<string, unknown> = {}) => ({
    id: 'q1', name: 'The Ledger Job', status: 'AVAILABLE', progressLog: null,
    objectiveKey: 'the-ledger-job', minCorruption: null, maxCorruption: 2, ...over,
  })

  it('refuses a quest to a party too marked to take it', async () => {
    tx.quest.findFirst.mockResolvedValue(gated())
    tx.character.findMany.mockResolvedValue([{ corruption: 0 }, { corruption: 4 }])

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { status: 'ACTIVE' } } as QuestChange,
    ])

    const data = tx.quest.update.mock.calls[0]?.[0]?.data
    expect(data?.status).toBeUndefined()
  })

  it('judges the party by its most-marked member, which is what a giver sees', async () => {
    tx.quest.findFirst.mockResolvedValue(gated())
    tx.character.findMany.mockResolvedValue([{ corruption: 0 }, { corruption: 1 }])

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { status: 'ACTIVE' } } as QuestChange,
    ])

    expect(tx.quest.updateMany.mock.calls[0][0].data.status).toBe('ACTIVE')
  })

  it('never revokes a quest already underway', async () => {
    // The trap this rule exists to prevent: gaining a mark mid-job must
    // not strand the party on a quest they can no longer touch.
    tx.quest.findFirst.mockResolvedValue(gated({ status: 'ACTIVE' }))
    tx.character.findMany.mockResolvedValue([{ corruption: 5 }])

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { progress_append: 'Found the ledger.' } } as QuestChange,
    ])

    expect(tx.character.findMany).not.toHaveBeenCalled()
    expect(tx.quest.update).toHaveBeenCalled()
  })

  it('never blocks completion of a gated quest', async () => {
    tx.quest.findFirst.mockResolvedValue(gated({ status: 'ACTIVE' }))
    tx.character.findMany.mockResolvedValue([{ corruption: 5 }])

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { status: 'COMPLETED' } } as QuestChange,
    ])

    expect(tx.quest.updateMany.mock.calls[0][0].data.status).toBe('COMPLETED')
  })

  it('never gates a campaign with no corruption theme', async () => {
    tx.quest.findFirst.mockResolvedValue(gated())
    tx.campaign.findUnique.mockResolvedValue({ corruptionTheme: null })
    tx.character.findMany.mockResolvedValue([{ corruption: 5 }])

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { status: 'ACTIVE' } } as QuestChange,
    ])

    expect(tx.quest.updateMany.mock.calls[0][0].data.status).toBe('ACTIVE')
  })

  it('never looks up gate context for an ungated quest', async () => {
    tx.quest.findFirst.mockResolvedValue(gated({ minCorruption: null, maxCorruption: null }))
    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { status: 'ACTIVE' } } as QuestChange,
    ])
    expect(tx.campaign.findUnique).not.toHaveBeenCalled()
  })

  it('allows the quest when the gate lookup fails', async () => {
    // Fails open: refusing a quest the fiction just handed over silently
    // loses a thread.
    tx.quest.findFirst.mockResolvedValue(gated())
    tx.campaign.findUnique.mockRejectedValue(new Error('db down'))

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { status: 'ACTIVE' } } as QuestChange,
    ])

    expect(tx.quest.updateMany.mock.calls[0][0].data.status).toBe('ACTIVE')
  })

  it('persists gates the fiction reports, including lifting one', async () => {
    tx.quest.findFirst.mockResolvedValue(gated())
    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { min_corruption: 2, max_corruption: 5 } } as QuestChange,
    ])
    expect(tx.quest.update.mock.calls[0][0].data).toMatchObject({ minCorruption: 2, maxCorruption: 5 })
  })
})

// ---------------------------------------------------------------------------
// Condition acquisition gate (#206)
// ---------------------------------------------------------------------------
// Same ACQUISITION-only boundary as the corruption gate above, but keyed on
// the resolved giver NPC's own location's condition instead of the quest's
// own min/maxCorruption fields.

describe('applyQuestChanges — condition acquisition gate', () => {
  // Ungated on corruption (min/maxCorruption both null) so only the
  // condition half of questAcquisitionAllowed is under test here.
  const ungated = (over: Record<string, unknown> = {}) => ({
    id: 'q1', name: 'The Ledger Job', status: 'AVAILABLE', progressLog: null,
    objectiveKey: 'the-ledger-job', minCorruption: null, maxCorruption: null,
    givenByNpcId: null, givenByFactionId: null, ...over,
  })

  it('refuses a quest whose giver stands in a RUINED location', async () => {
    tx.quest.findFirst.mockResolvedValue(ungated({ givenByNpcId: 'npc1' }))
    tx.nPC.findUnique.mockResolvedValue({ location: { conditionScore: 10, isContested: false } })

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { status: 'ACTIVE' } } as QuestChange,
    ])

    expect(tx.nPC.findUnique).toHaveBeenCalledWith({
      where: { id: 'npc1' },
      select: { location: { select: { conditionScore: true, isContested: true } } },
    })
    const data = tx.quest.update.mock.calls[0]?.[0]?.data
    expect(data?.status).toBeUndefined()
  })

  it('refuses a quest whose giver stands in an ABANDONED location', async () => {
    tx.quest.findFirst.mockResolvedValue(ungated({ givenByNpcId: 'npc1' }))
    tx.nPC.findUnique.mockResolvedValue({ location: { conditionScore: 0, isContested: false } })

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { status: 'ACTIVE' } } as QuestChange,
    ])

    expect(tx.quest.update.mock.calls[0]?.[0]?.data?.status).toBeUndefined()
  })

  it('allows a quest whose giver stands in a STABLE (or better) location', async () => {
    tx.quest.findFirst.mockResolvedValue(ungated({ givenByNpcId: 'npc1' }))
    tx.nPC.findUnique.mockResolvedValue({ location: { conditionScore: 60, isContested: false } })

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { status: 'ACTIVE' } } as QuestChange,
    ])

    expect(tx.quest.updateMany.mock.calls[0][0].data.status).toBe('ACTIVE')
  })

  it('never checks a location for a faction-given or unresolved quest', async () => {
    tx.quest.findFirst.mockResolvedValue(ungated({ givenByFactionId: 'f1' }))

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { status: 'ACTIVE' } } as QuestChange,
    ])

    expect(tx.nPC.findUnique).not.toHaveBeenCalled()
    expect(tx.quest.updateMany.mock.calls[0][0].data.status).toBe('ACTIVE')
  })

  it('allows the quest when the giver has no location resolved yet', async () => {
    tx.quest.findFirst.mockResolvedValue(ungated({ givenByNpcId: 'npc1' }))
    tx.nPC.findUnique.mockResolvedValue({ location: null })

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { status: 'ACTIVE' } } as QuestChange,
    ])

    expect(tx.quest.updateMany.mock.calls[0][0].data.status).toBe('ACTIVE')
  })

  it('allows the quest when the condition lookup fails (fails open)', async () => {
    tx.quest.findFirst.mockResolvedValue(ungated({ givenByNpcId: 'npc1' }))
    tx.nPC.findUnique.mockRejectedValue(new Error('db down'))

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { status: 'ACTIVE' } } as QuestChange,
    ])

    expect(tx.quest.updateMany.mock.calls[0][0].data.status).toBe('ACTIVE')
  })

  it('prefers a giver re-resolved in this same batch over the stale row', async () => {
    // The quest change reports a NEW given_by this turn — the freshly
    // resolved NPC's location should gate, not whatever the row said before.
    tx.quest.findFirst.mockResolvedValue(ungated({ givenByNpcId: 'old-npc' }))
    tx.nPC.findMany.mockResolvedValue([{ id: 'new-npc', name: 'Bram the Fence' }])
    tx.nPC.findUnique.mockResolvedValue({ location: { conditionScore: 5, isContested: false } })

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { status: 'ACTIVE', given_by: 'Bram the Fence' } } as QuestChange,
    ])

    expect(tx.nPC.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'new-npc' } }))
    expect(tx.quest.update.mock.calls[0]?.[0]?.data?.status).toBeUndefined()
  })

  it('never revokes an already-active quest even if the giver location has since decayed', async () => {
    tx.quest.findFirst.mockResolvedValue(ungated({ status: 'ACTIVE', givenByNpcId: 'npc1' }))

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { progress_append: 'Found the ledger.' } } as QuestChange,
    ])

    expect(tx.nPC.findUnique).not.toHaveBeenCalled()
    expect(tx.quest.update).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Failure consequences — the other side of the reward ledger.
// ---------------------------------------------------------------------------
// FAILED/ABANDONED were inert after #45/#75 gave quests the structure to
// have consequences. These pin the wiring: it fires on a real transition,
// exactly once, and passes the giver the same way the payout does.

describe('applyQuestChanges — failure consequences', () => {
  const active = (over: Record<string, unknown> = {}) => ({
    id: 'q1',
    name: 'The Ledger Job',
    status: 'ACTIVE',
    progressLog: null,
    givenByNpcId: null,
    givenByFactionId: 'f1',
    minCorruption: null,
    maxCorruption: null,
    ...over,
  })

  it('charges the party when a quest is abandoned', async () => {
    tx.quest.findFirst.mockResolvedValue(active())

    await applyQuestChanges(tx as any, 'camp1', 3, [
      { name: 'The Ledger Job', changes: { status: 'ABANDONED' } } as QuestChange,
    ])

    expect(applyQuestFailureCost).toHaveBeenCalledTimes(1)
    const [, campaignId, quest, status] = vi.mocked(applyQuestFailureCost).mock.calls[0]
    expect(campaignId).toBe('camp1')
    expect(status).toBe('ABANDONED')
    expect(quest).toMatchObject({ name: 'The Ledger Job', givenByFactionId: 'f1' })
  })

  it('charges the party when a quest is failed', async () => {
    tx.quest.findFirst.mockResolvedValue(active())

    await applyQuestChanges(tx as any, 'camp1', 3, [
      { name: 'The Ledger Job', changes: { status: 'FAILED' } } as QuestChange,
    ])

    expect(vi.mocked(applyQuestFailureCost).mock.calls[0][3]).toBe('FAILED')
  })

  it('does not charge twice for a quest already in that state', async () => {
    // The once-only guard, matching the payout's. A repeated report of an
    // already-failed quest must not re-charge one broken promise.
    tx.quest.findFirst.mockResolvedValue(active({ status: 'FAILED' }))

    await applyQuestChanges(tx as any, 'camp1', 3, [
      { name: 'The Ledger Job', changes: { status: 'FAILED' } } as QuestChange,
    ])

    expect(applyQuestFailureCost).not.toHaveBeenCalled()
  })

  it('does charge when a failed quest is later abandoned outright', async () => {
    // A different outcome is a different event, not a repeat.
    tx.quest.findFirst.mockResolvedValue(active({ status: 'FAILED' }))

    await applyQuestChanges(tx as any, 'camp1', 3, [
      { name: 'The Ledger Job', changes: { status: 'ABANDONED' } } as QuestChange,
    ])

    expect(applyQuestFailureCost).toHaveBeenCalledTimes(1)
  })

  it('charges nothing when a quest merely progresses', async () => {
    tx.quest.findFirst.mockResolvedValue(active())

    await applyQuestChanges(tx as any, 'camp1', 3, [
      { name: 'The Ledger Job', changes: { progress_append: 'Found the ledger.' } } as QuestChange,
    ])

    expect(applyQuestFailureCost).not.toHaveBeenCalled()
  })

  it('charges nothing when a quest completes', async () => {
    tx.quest.findFirst.mockResolvedValue(active())

    await applyQuestChanges(tx as any, 'camp1', 3, [
      { name: 'The Ledger Job', changes: { status: 'COMPLETED' } } as QuestChange,
    ])

    expect(applyQuestFailureCost).not.toHaveBeenCalled()
  })
})

describe('applyQuestChanges — illegal status transitions (#281)', () => {
  const active = (over: Record<string, unknown> = {}) => ({
    id: 'q1',
    name: 'The Ledger Job',
    status: 'ACTIVE',
    progressLog: null,
    givenByNpcId: null,
    givenByFactionId: 'f1',
    minCorruption: null,
    maxCorruption: null,
    ...over,
  })

  it('refuses to grant a completion reward for a quest already FAILED — the exact exploit this issue names', async () => {
    tx.quest.findFirst.mockResolvedValue(active({ status: 'FAILED' }))

    await applyQuestChanges(tx as any, 'camp1', 3, [
      { name: 'The Ledger Job', changes: { status: 'COMPLETED', reward_grant: { gold: 50 } } } as QuestChange,
    ])

    expect(applyQuestRewardGrant).not.toHaveBeenCalled()
    // The illegal status is never even written — a quest reported
    // COMPLETED against a FAILED row must stay FAILED, not silently
    // acquire a second, contradictory resolution.
    expect(tx.quest.updateMany).not.toHaveBeenCalled()
  })

  it('refuses to grant a completion reward for a quest already ABANDONED', async () => {
    tx.quest.findFirst.mockResolvedValue(active({ status: 'ABANDONED' }))

    await applyQuestChanges(tx as any, 'camp1', 3, [
      { name: 'The Ledger Job', changes: { status: 'COMPLETED', reward_grant: { gold: 50 } } } as QuestChange,
    ])

    expect(applyQuestRewardGrant).not.toHaveBeenCalled()
    expect(tx.quest.updateMany).not.toHaveBeenCalled()
  })

  it('refuses to reactivate a genuinely completed quest', async () => {
    tx.quest.findFirst.mockResolvedValue(active({ status: 'COMPLETED' }))

    await applyQuestChanges(tx as any, 'camp1', 3, [
      { name: 'The Ledger Job', changes: { status: 'ACTIVE' } } as QuestChange,
    ])

    expect(tx.quest.updateMany).not.toHaveBeenCalled()
  })

  it('still allows a plain field update (no status change) on a resolved quest', async () => {
    // The illegality check only ever gates a reported status change —
    // description/progress-log edits on an already-resolved quest are
    // unaffected bookkeeping, not a resolution being contested.
    tx.quest.findFirst.mockResolvedValue(active({ status: 'FAILED' }))

    await applyQuestChanges(tx as any, 'camp1', 3, [
      { name: 'The Ledger Job', changes: { description: 'Updated after the fact.' } } as QuestChange,
    ])

    expect(tx.quest.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: expect.objectContaining({ description: 'Updated after the fact.' }),
    })
  })
})
