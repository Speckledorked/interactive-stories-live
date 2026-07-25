import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyQuestChanges, QuestChange } from '../quests'

vi.mock('../../questRewards', () => ({
  applyQuestRewardGrant: vi.fn(async () => ['Jason received 50 gold from completing "Clear the Warrens"']),
}))
import { applyQuestRewardGrant } from '../../questRewards'

const makeTx = () => ({
  quest: {
    findFirst: vi.fn(),
    update: vi.fn(async (_args: any) => ({})),
    create: vi.fn(async () => ({})),
  },
  // Quest-giver rosters (#75), loaded lazily and at most once per batch.
  nPC: { findMany: vi.fn(async (): Promise<Array<{ id: string; name: string }>> => []) },
  faction: { findMany: vi.fn(async (): Promise<Array<{ id: string; name: string }>> => []) },
  // Corruption acquisition gate (#83) context.
  campaign: { findUnique: vi.fn(async (): Promise<{ corruptionTheme: unknown } | null> => ({ corruptionTheme: { name: 'the Rot' } })) },
  character: { findMany: vi.fn(async (): Promise<Array<{ corruption: number }>> => []) },
})

let tx: ReturnType<typeof makeTx>
beforeEach(() => {
  tx = makeTx()
  vi.mocked(applyQuestRewardGrant).mockClear()
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

  it('does NOT re-pay a reward grant on a repeated report of an already-completed quest', async () => {
    tx.quest.findFirst.mockResolvedValue({ ...existing, status: 'COMPLETED' })
    await applyQuestChanges(tx as any, 'camp1', 6, [
      { name: 'Clear the Warrens', changes: { status: 'COMPLETED', reward_grant: { gold: 50 } } } as QuestChange,
    ])
    expect(applyQuestRewardGrant).not.toHaveBeenCalled()
  })

  it('sets resolvedAt when status moves to a non-ACTIVE terminal state', async () => {
    tx.quest.findFirst.mockResolvedValue({ ...existing, status: 'ACTIVE' })
    await applyQuestChanges(tx as any, 'camp1', 7, [
      { name: 'Clear the Warrens', changes: { status: 'FAILED' } } as QuestChange,
    ])
    const call = tx.quest.update.mock.calls[0][0]
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

    expect(tx.quest.update.mock.calls[0][0].data.status).toBe('ACTIVE')
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

    expect(tx.quest.update.mock.calls[0][0].data.status).toBe('COMPLETED')
  })

  it('never gates a campaign with no corruption theme', async () => {
    tx.quest.findFirst.mockResolvedValue(gated())
    tx.campaign.findUnique.mockResolvedValue({ corruptionTheme: null })
    tx.character.findMany.mockResolvedValue([{ corruption: 5 }])

    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { status: 'ACTIVE' } } as QuestChange,
    ])

    expect(tx.quest.update.mock.calls[0][0].data.status).toBe('ACTIVE')
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

    expect(tx.quest.update.mock.calls[0][0].data.status).toBe('ACTIVE')
  })

  it('persists gates the fiction reports, including lifting one', async () => {
    tx.quest.findFirst.mockResolvedValue(gated())
    await applyQuestChanges(tx as any, 'camp1', 5, [
      { name: 'The Ledger Job', changes: { min_corruption: 2, max_corruption: 5 } } as QuestChange,
    ])
    expect(tx.quest.update.mock.calls[0][0].data).toMatchObject({ minCorruption: 2, maxCorruption: 5 })
  })
})
