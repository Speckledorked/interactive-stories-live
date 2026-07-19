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

    expect(applyQuestRewardGrant).toHaveBeenCalledWith(tx, 'camp1', 'Clear the Warrens', { gold: 50 })
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
    tx.quest.findFirst.mockResolvedValue({ ...existing })
    await applyQuestChanges(tx as any, 'camp1', 8, [
      { name: 'Clear the Warrens', changes: {} } as QuestChange,
    ])
    expect(tx.quest.update).not.toHaveBeenCalled()
  })
})
