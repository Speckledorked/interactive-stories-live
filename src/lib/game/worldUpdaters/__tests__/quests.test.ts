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

    // Trailing arg is the quest's resolved giver faction, which funds the
    // payout when the grant names no payer — null here, since this quest
    // reported no giver.
    expect(applyQuestRewardGrant).toHaveBeenCalledWith(tx, 'camp1', 'Clear the Warrens', { gold: 50 }, null)
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
    // objectiveKey is unique per campaign and these writes run inside the
    // scene-resolution transaction: a collision would abort the whole batch
    // and take unrelated quest progress with it. Losing a handle is cheap;
    // losing the turn is not.
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
