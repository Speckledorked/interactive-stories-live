// src/lib/game/__tests__/retention.test.ts
//
// #442. This module had no test coverage at all, which is how two early
// returns came to sit above the telemetry deletes without anyone noticing.
//
// The bug in one line: DiceRoll and AICostEntry are pruned on a REAL-TIME
// basis and have nothing to do with simulation turns, but they were
// unreachable behind two returns keyed on a different table's turn age. The
// two highest-volume telemetry tables in the schema were never pruned until
// a campaign was ~360 simulation turns old — i.e. nearly never, and exactly
// backwards, since telemetry accumulates fastest when play is most active.
//
// An early return is a claim about the WHOLE function. These tests are
// mostly about which work survives one.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  worldMeta: { findUnique: vi.fn() },
  worldEvent: { findMany: vi.fn(), deleteMany: vi.fn() },
  eventWitness: { deleteMany: vi.fn() },
  diceRoll: { deleteMany: vi.fn() },
  aICostEntry: { deleteMany: vi.fn() },
  campaignMemory: { deleteMany: vi.fn() },
  memoryCreationFailure: { deleteMany: vi.fn() },
  notification: { findMany: vi.fn(), deleteMany: vi.fn() },
  analyticsEvent: { findMany: vi.fn(), deleteMany: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { pruneCampaignHistory, pruneGlobalTables, EVENT_RETENTION_TURNS, READ_NOTIFICATION_RETENTION_MS } from '../retention'

beforeEach(() => {
  vi.clearAllMocks()
  db.worldMeta.findUnique.mockResolvedValue({ simulationTurn: 0 })
  db.worldEvent.findMany.mockResolvedValue([])
  db.worldEvent.deleteMany.mockResolvedValue({ count: 0 })
  db.eventWitness.deleteMany.mockResolvedValue({ count: 0 })
  db.diceRoll.deleteMany.mockResolvedValue({ count: 3 })
  db.aICostEntry.deleteMany.mockResolvedValue({ count: 5 })
  db.campaignMemory.deleteMany.mockResolvedValue({ count: 2 })
  db.memoryCreationFailure.deleteMany.mockResolvedValue({ count: 4 })
})

describe('telemetry pruning is independent of world-event age (#442)', () => {
  it('prunes a brand-new campaign, whose cutoff turn is negative', () => {
    // The return that fired for essentially every campaign in existence.
    db.worldMeta.findUnique.mockResolvedValue({ simulationTurn: 1 })

    return pruneCampaignHistory('camp1').then((result) => {
      expect(db.diceRoll.deleteMany).toHaveBeenCalled()
      expect(db.aICostEntry.deleteMany).toHaveBeenCalled()
      expect(result.diceRollsDeleted).toBe(3)
      expect(result.aiCostEntriesDeleted).toBe(5)
    })
  })

  it('prunes an old campaign that happens to have no stale events', async () => {
    // The second return, the one the audit named.
    db.worldMeta.findUnique.mockResolvedValue({ simulationTurn: EVENT_RETENTION_TURNS + 50 })
    db.worldEvent.findMany.mockResolvedValue([])

    const result = await pruneCampaignHistory('camp1')

    expect(db.diceRoll.deleteMany).toHaveBeenCalled()
    expect(result.aiCostEntriesDeleted).toBe(5)
    expect(result.worldEventsDeleted).toBe(0)
  })

  it('prunes on a real-time cutoff, not a turn-derived one', async () => {
    await pruneCampaignHistory('camp1')

    const where = db.diceRoll.deleteMany.mock.calls[0][0].where
    expect(where.createdAt.lt).toBeInstanceOf(Date)
    expect(where).not.toHaveProperty('turnNumber')
  })

  it('still prunes world events once the campaign is old enough', async () => {
    db.worldMeta.findUnique.mockResolvedValue({ simulationTurn: EVENT_RETENTION_TURNS + 10 })
    db.worldEvent.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }])
    db.worldEvent.deleteMany.mockResolvedValue({ count: 2 })
    db.eventWitness.deleteMany.mockResolvedValue({ count: 4 })

    const result = await pruneCampaignHistory('camp1')

    // Witnesses before events — otherwise the FK cascade decides the order
    // and the batch bound stops meaning anything.
    expect(db.eventWitness.deleteMany).toHaveBeenCalled()
    expect(result.worldEventsDeleted).toBe(2)
    expect(result.eventWitnessesDeleted).toBe(4)
  })
})

describe('the memory archive is bounded (C-13, #442)', () => {
  it('retires archived memories, which nothing used to', async () => {
    // #392 made consolidation archive rather than delete. Safer for the
    // data, and it left memoryConsolidation's stated purpose — "so the table
    // stays bounded" — unmet, because nothing ever retired an archived row.
    const result = await pruneCampaignHistory('camp1')

    expect(db.campaignMemory.deleteMany).toHaveBeenCalledWith({
      where: { campaignId: 'camp1', archivedAt: { lt: expect.any(Date) } },
    })
    expect(result.archivedMemoriesDeleted).toBe(2)
  })

  it('never touches a memory that is still live', async () => {
    await pruneCampaignHistory('camp1')

    // `archivedAt: { lt: ... }` cannot match NULL in Postgres, so a live
    // memory is excluded by the predicate itself rather than by a filter
    // someone has to remember to add.
    const where = db.campaignMemory.deleteMany.mock.calls[0][0].where
    expect(where.archivedAt).toHaveProperty('lt')
  })
})

describe('the last write-only table is bounded (#445)', () => {
  it('prunes memory-creation failures on a real-time cutoff', async () => {
    // #408's own module comment listed MemoryCreationFailure among the
    // eighteen tables with zero delete sites, and it was still one of them.
    const result = await pruneCampaignHistory('camp1')

    const where = db.memoryCreationFailure.deleteMany.mock.calls[0][0].where
    expect(where.campaignId).toBe('camp1')
    expect(where.createdAt.lt).toBeInstanceOf(Date)
    expect(where).not.toHaveProperty('turnNumber')
    expect(result.memoryFailuresDeleted).toBe(4)
  })

  it('prunes it even for a brand-new campaign, above the turn-keyed return', async () => {
    // Same reasoning as the telemetry deletes: these rows record a wall-clock
    // failure, not a simulation event, so they must not sit below a return
    // keyed on another table's turn age (#442).
    db.worldMeta.findUnique.mockResolvedValue({ simulationTurn: 1 })

    const result = await pruneCampaignHistory('camp1')

    expect(db.memoryCreationFailure.deleteMany).toHaveBeenCalled()
    expect(result.memoryFailuresDeleted).toBe(4)
  })

  it('keeps the window far longer than the telemetry window', async () => {
    // The table exists so a retry/reader #284 anticipated can recreate the
    // exact memory that failed. That reader still does not exist, so the
    // window is generous on purpose — pruning it aggressively would throw
    // away the only record that a scene vanished from campaign history.
    await pruneCampaignHistory('camp1')

    const failureCutoff = db.memoryCreationFailure.deleteMany.mock.calls[0][0].where.createdAt.lt
    expect(Date.now() - failureCutoff.getTime()).toBeGreaterThan(30 * 24 * 60 * 60 * 1000)
  })
})

// #501: six tables were named as having no delete path. Two of them
// genuinely needed one; four are decisions rather than omissions, and are
// written down in the module rather than left as a gap for the next audit
// to re-find.
//
// The other half of #501 matters as much: per-campaign retention only runs
// for campaigns that TICKED, so a dormant campaign is pruned never — and a
// user who stopped playing accumulates notifications forever, because no
// campaign of theirs is ticking to carry the pass. These tables are not
// campaign-scoped, so they get their own.
describe('pruneGlobalTables (#501)', () => {
  beforeEach(() => {
    db.notification.findMany.mockResolvedValue([])
    db.notification.deleteMany.mockResolvedValue({ count: 0 })
    db.analyticsEvent.findMany.mockResolvedValue([])
    db.analyticsEvent.deleteMany.mockResolvedValue({ count: 0 })
  })

  it('only ever selects notifications the person is finished with', async () => {
    await pruneGlobalTables()
    const where = db.notification.findMany.mock.calls[0][0].where
    // An UNREAD notification is still doing its job however old it is.
    // Deleting one silently withdraws a message nobody ever saw.
    expect(where.status).toEqual({ in: ['READ', 'DISMISSED'] })
    expect(where.createdAt.lt.getTime()).toBeLessThanOrEqual(Date.now() - READ_NOTIFICATION_RETENTION_MS + 1000)
  })

  it('bounds each delete, so a backlog cannot take the sweep down with it', async () => {
    await pruneGlobalTables()
    expect(db.notification.findMany.mock.calls[0][0].take).toBeGreaterThan(0)
    expect(db.analyticsEvent.findMany.mock.calls[0][0].take).toBeGreaterThan(0)
    // Oldest first, so repeated runs make progress rather than re-reading
    // the same page.
    expect(db.notification.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' })
  })

  it('issues no delete when there is nothing to delete', async () => {
    const result = await pruneGlobalTables()
    expect(db.notification.deleteMany).not.toHaveBeenCalled()
    expect(db.analyticsEvent.deleteMany).not.toHaveBeenCalled()
    expect(result).toEqual({ notificationsDeleted: 0, analyticsEventsDeleted: 0 })
  })

  it('reports what it deleted', async () => {
    db.notification.findMany.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }])
    db.notification.deleteMany.mockResolvedValue({ count: 2 })
    db.analyticsEvent.findMany.mockResolvedValue([{ id: 'a1' }])
    db.analyticsEvent.deleteMany.mockResolvedValue({ count: 1 })

    const result = await pruneGlobalTables()

    expect(result).toEqual({ notificationsDeleted: 2, analyticsEventsDeleted: 1 })
    expect(db.notification.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['n1', 'n2'] } } })
  })

  it('touches none of the four tables that are kept on purpose', async () => {
    // Transaction most of all: deleting it is not a retention policy, it
    // is destroying financial records, and /privacy commits to keeping
    // them. CampaignLog, Message and PlayerAction are the durable record.
    await pruneGlobalTables()
    for (const table of ['transaction', 'campaignLog', 'message', 'playerAction']) {
      expect((db as any)[table], `pruneGlobalTables must not reach for ${table}`).toBeUndefined()
    }
  })
})
