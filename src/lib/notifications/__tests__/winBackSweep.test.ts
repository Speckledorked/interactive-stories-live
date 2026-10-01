// src/lib/notifications/__tests__/winBackSweep.test.ts
//
// #506 — what the sweep writes, and what it refuses to.
//
// winBack.test.ts covers the decision. This covers the parts that only go
// wrong against a database: the window being applied in the query rather
// than only in the decider, a missing settings row meaning defaults rather
// than silence, and — the one that costs a real person something — a letter
// that was never actually sent still burning one of three lifetime sends.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignMembership: { findMany: vi.fn(), update: vi.fn() },
    userNotificationSettings: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/game/absenceJournalQuery', () => ({ loadAbsenceJournal: vi.fn() }))
vi.mock('../email-service', () => ({
  EmailService: { sendWinBackEmail: vi.fn() },
}))

import { prisma } from '@/lib/prisma'
import { loadAbsenceJournal } from '@/lib/game/absenceJournalQuery'
import { EmailService } from '../email-service'
import { sweepWinBackEmails, MAX_SENDS_PER_SWEEP } from '../winBackSweep'
import { LAPSE_AFTER_DAYS, ABANDON_AFTER_DAYS } from '../winBack'

const db = prisma as any
const NOW = new Date('2026-10-01T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem1',
    userId: 'user1',
    campaignId: 'camp1',
    role: 'PLAYER',
    lastViewedAt: new Date(NOW.getTime() - 10 * DAY),
    winBackSentAt: null,
    winBackCount: 0,
    user: { email: 'player@example.com', name: 'Ada' },
    campaign: { title: 'Ashfall' },
    ...overrides,
  }
}

/** A journal with something in it — the sweep refuses an empty one. */
function journalWith(entryCount: number, totalEvents = entryCount) {
  return {
    entries: Array.from({ length: entryCount }, (_, i) => ({
      id: `e${i}`, turnNumber: 4, createdAt: NOW, targetType: 'FACTION',
      targetId: `f${i}`, targetName: `Faction ${i}`, field: 'stability',
      significant: true, importance: 'MAJOR', category: 'factions',
    })),
    categoriesPresent: ['factions'],
    totalEvents,
    turnRange: { from: 1, to: 4 },
    truncated: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.campaignMembership.findMany.mockResolvedValue([member()])
  db.userNotificationSettings.findMany.mockResolvedValue([])
  ;(loadAbsenceJournal as any).mockResolvedValue(journalWith(3))
  ;(EmailService.sendWinBackEmail as any).mockResolvedValue(true)
})

describe('the query window', () => {
  it('asks the database only for memberships that could possibly qualify', () => {
    // Without a window in the query this reads every membership in the
    // product every night to discard almost all of them.
    return sweepWinBackEmails(NOW).then(() => {
      const where = db.campaignMembership.findMany.mock.calls[0][0].where
      expect(where.lastViewedAt.lt.getTime()).toBe(NOW.getTime() - LAPSE_AFTER_DAYS * DAY)
      expect(where.lastViewedAt.gte.getTime()).toBe(NOW.getTime() - ABANDON_AFTER_DAYS * DAY)
    })
  })

  it('works the backlog oldest-lapsed first', async () => {
    // A sweep that hits its cap must make progress through the queue rather
    // than re-rolling the same arbitrary slice every night.
    await sweepWinBackEmails(NOW)
    expect(db.campaignMembership.findMany.mock.calls[0][0].orderBy).toEqual({ lastViewedAt: 'asc' })
  })
})

describe('sending', () => {
  it('sends, and records the send against that seat', async () => {
    const result = await sweepWinBackEmails(NOW)

    expect(result.sent).toBe(1)
    expect(EmailService.sendWinBackEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'player@example.com', campaignTitle: 'Ashfall' })
    )
    expect(db.campaignMembership.update).toHaveBeenCalledWith({
      where: { id: 'mem1' },
      data: { winBackSentAt: NOW, winBackCount: { increment: 1 } },
    })
  })

  it('builds the letter from the journal loaded for that member\'s own role', async () => {
    // The fog gate. Loading it for anyone else's role would put factions
    // and NPCs this player has not discovered into their inbox.
    db.campaignMembership.findMany.mockResolvedValue([member({ role: 'PLAYER' })])
    await sweepWinBackEmails(NOW)
    expect(loadAbsenceJournal).toHaveBeenCalledWith('camp1', expect.any(Date), 'PLAYER')
  })

  it('treats a missing settings row as the defaults, not as a refusal', async () => {
    // Most users have never opened the settings page. Reading absence as
    // "off" would silently exclude nearly everyone.
    db.userNotificationSettings.findMany.mockResolvedValue([])
    expect((await sweepWinBackEmails(NOW)).sent).toBe(1)
  })

  it('honours an explicit opt-out', async () => {
    db.userNotificationSettings.findMany.mockResolvedValue([
      { userId: 'user1', emailEnabled: true, emailWinBack: false },
    ])
    const result = await sweepWinBackEmails(NOW)
    expect(result.sent).toBe(0)
    expect(result.skipped['emails-off']).toBe(1)
    expect(EmailService.sendWinBackEmail).not.toHaveBeenCalled()
  })

  it('honours the master email switch too', async () => {
    db.userNotificationSettings.findMany.mockResolvedValue([
      { userId: 'user1', emailEnabled: false, emailWinBack: true },
    ])
    expect((await sweepWinBackEmails(NOW)).sent).toBe(0)
  })
})

describe('refusing to write an empty letter', () => {
  it('sends nothing when the member can see none of what happened', async () => {
    // A window full of events that are all fogged for this player renders
    // an empty body — which is the "we miss you" mail this feature exists
    // not to send. Asserted on entries, not totalEvents, for that reason.
    ;(loadAbsenceJournal as any).mockResolvedValue(journalWith(0, 40))
    const result = await sweepWinBackEmails(NOW)
    expect(result.sent).toBe(0)
    expect(result.skipped['nothing-happened']).toBe(1)
    expect(EmailService.sendWinBackEmail).not.toHaveBeenCalled()
  })
})

describe('not burning a send that did not happen', () => {
  it('does not count an unsent letter against the lifetime cap', async () => {
    // An unconfigured transporter returns false rather than throwing. If
    // that counted, a misconfigured deployment would silently spend all
    // three of everyone's letters on nothing and never write again.
    ;(EmailService.sendWinBackEmail as any).mockResolvedValue(false)
    const result = await sweepWinBackEmails(NOW)

    expect(result.sent).toBe(0)
    expect(result.failed).toBe(1)
    expect(db.campaignMembership.update).not.toHaveBeenCalled()
  })

  it('does not count a thrown send either, and keeps going', async () => {
    db.campaignMembership.findMany.mockResolvedValue([
      member({ id: 'mem1', userId: 'user1' }),
      member({ id: 'mem2', userId: 'user2' }),
    ])
    ;(EmailService.sendWinBackEmail as any)
      .mockRejectedValueOnce(new Error('smtp down'))
      .mockResolvedValue(true)

    const result = await sweepWinBackEmails(NOW)

    expect(result.failed).toBe(1)
    expect(result.sent).toBe(1)
    expect(db.campaignMembership.update).toHaveBeenCalledTimes(1)
    expect(db.campaignMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'mem2' } })
    )
  })
})

describe('the per-sweep cap', () => {
  it('stops at the cap and leaves the rest for tomorrow', async () => {
    db.campaignMembership.findMany.mockResolvedValue(
      Array.from({ length: MAX_SENDS_PER_SWEEP + 5 }, (_, i) =>
        member({ id: `mem${i}`, userId: `user${i}` })
      )
    )
    const result = await sweepWinBackEmails(NOW)
    expect(result.sent).toBe(MAX_SENDS_PER_SWEEP)
  })
})

describe('an empty night', () => {
  it('reads nothing further when no membership is in the window', async () => {
    db.campaignMembership.findMany.mockResolvedValue([])
    const result = await sweepWinBackEmails(NOW)
    expect(result).toMatchObject({ considered: 0, sent: 0, failed: 0 })
    expect(db.userNotificationSettings.findMany).not.toHaveBeenCalled()
  })
})
