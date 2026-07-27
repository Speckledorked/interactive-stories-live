import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    faction: { findMany: vi.fn().mockResolvedValue([]) },
    nPC: { findMany: vi.fn().mockResolvedValue([]) },
    campaignMembership: { findMany: vi.fn().mockResolvedValue([]) },
    timelineEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
}))

vi.mock('../notification-service', () => ({
  NotificationService: { createNotification: vi.fn().mockResolvedValue(undefined) },
}))

import { prisma } from '@/lib/prisma'
import { NotificationService } from '../notification-service'
import {
  selectDigestChanges,
  formatDigestLine,
  titleForDigestChange,
  sendWorldDigest,
  MAX_DIGEST_LINES,
} from '../world-digest'
import type { WorldChange } from '@/lib/game/tick/types'

function makeChange(overrides: Partial<WorldChange> = {}): WorldChange {
  return {
    entityType: 'FACTION',
    entityId: 'faction-1',
    entityName: 'The Thieves Guild',
    campaignId: 'campaign-1',
    field: 'warDeclared',
    previousValue: 'PEACE',
    newValue: 'WAR',
    reason: 'GM-grade reasoning that must never reach the digest',
    significant: true,
    importance: 'MAJOR',
    ...overrides,
  }
}

describe('selectDigestChanges', () => {
  it('keeps only significant + MAJOR changes on a discovered entity', () => {
    const discovered = new Set(['faction-1'])
    const changes = [
      makeChange(),
      makeChange({ significant: false }),
      makeChange({ importance: 'NORMAL' }),
      makeChange({ entityId: 'faction-2' }), // not discovered
    ]
    expect(selectDigestChanges(changes, discovered)).toEqual([changes[0]])
  })

  it('caps at MAX_DIGEST_LINES', () => {
    const discovered = new Set(['faction-1'])
    const changes = Array.from({ length: MAX_DIGEST_LINES + 5 }, () => makeChange())
    expect(selectDigestChanges(changes, discovered)).toHaveLength(MAX_DIGEST_LINES)
  })
})

describe('formatDigestLine', () => {
  it('formats every known field', () => {
    expect(formatDigestLine(makeChange({ field: 'warDeclared', entityName: 'X' }))).toContain('X has declared war')
    expect(formatDigestLine(makeChange({ field: 'warJoined', entityName: 'X' }))).toContain('X has thrown its strength')
    expect(formatDigestLine(makeChange({ field: 'warResolved', entityName: 'X' }))).toContain('The war X was fighting is over')
    expect(formatDigestLine(makeChange({ field: 'warEnded', entityName: 'X' }))).toContain('The war X was fighting is over')
    expect(formatDigestLine(makeChange({ field: 'collapsed', entityName: 'X' }))).toContain('X has fallen')
    expect(formatDigestLine(makeChange({ field: 'founded', entityName: 'X' }))).toContain('calling itself X')
  })

  it('recognizes factionRole as a leadership change, not the generic fallback', () => {
    // The real bug this test guards against: leadershipTick.ts writes the
    // field as 'factionRole', not 'leader'/'leadership' — formatDigestLine
    // silently fell through to the vague default for every real
    // leadership-succession event until this was fixed.
    const line = formatDigestLine(makeChange({ field: 'factionRole', entityName: 'Vex' }))
    expect(line).toBe('Word is that Vex answers to new leadership.')
    expect(line).not.toContain('talk of upheaval')
  })

  it('still recognizes the literal leader/leadership field names', () => {
    expect(formatDigestLine(makeChange({ field: 'leader', entityName: 'X' }))).toContain('new leadership')
    expect(formatDigestLine(makeChange({ field: 'leadership', entityName: 'X' }))).toContain('new leadership')
  })

  it('falls back to the generic line for an unrecognized field', () => {
    expect(formatDigestLine(makeChange({ field: 'somethingElse', entityName: 'X' }))).toBe("There's talk of upheaval around X.")
  })
})

describe('titleForDigestChange', () => {
  it('gives factionRole the same specific title as leader/leadership', () => {
    expect(titleForDigestChange(makeChange({ field: 'factionRole' }))).toBe('New Leadership')
    expect(titleForDigestChange(makeChange({ field: 'leader' }))).toBe('New Leadership')
    expect(titleForDigestChange(makeChange({ field: 'leadership' }))).toBe('New Leadership')
  })

  it('falls back to a generic title for an unrecognized field', () => {
    expect(titleForDigestChange(makeChange({ field: 'somethingElse' }))).toBe('Word on the Street')
  })
})

describe('sendWorldDigest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when there are no changes', async () => {
    const result = await sendWorldDigest('campaign-1', [], 3)
    expect(result).toBe(0)
    expect(prisma.timelineEvent.createMany).not.toHaveBeenCalled()
    expect(NotificationService.createNotification).not.toHaveBeenCalled()
  })

  it('does nothing when nothing digest-worthy touches a discovered entity', async () => {
    vi.mocked(prisma.campaignMembership.findMany).mockResolvedValueOnce([{ userId: 'user-1' }] as any)
    const result = await sendWorldDigest('campaign-1', [makeChange({ significant: false })], 3)
    expect(result).toBe(0)
    expect(prisma.timelineEvent.createMany).not.toHaveBeenCalled()
  })

  it('writes one TimelineEvent per digest-worthy change, isOffscreen and PUBLIC', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([{ id: 'faction-1' }] as any)
    vi.mocked(prisma.campaignMembership.findMany).mockResolvedValueOnce([{ userId: 'user-1' }] as any)

    await sendWorldDigest('campaign-1', [makeChange({ field: 'factionRole', entityName: 'Vex' })], 5)

    expect(prisma.timelineEvent.createMany).toHaveBeenCalledTimes(1)
    const call = vi.mocked(prisma.timelineEvent.createMany).mock.calls[0][0] as any
    expect(call.data).toHaveLength(1)
    expect(call.data[0]).toMatchObject({
      campaignId: 'campaign-1',
      turnNumber: 5,
      title: 'New Leadership',
      summaryPublic: 'Word is that Vex answers to new leadership.',
      isOffscreen: true,
      visibility: 'PUBLIC',
      eventType: 'WORLD_EVENT',
    })
  })

  it('notifies every member with the same message and links to the Rumors tab', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([{ id: 'faction-1' }] as any)
    vi.mocked(prisma.campaignMembership.findMany).mockResolvedValueOnce([
      { userId: 'user-1' },
      { userId: 'user-2' },
    ] as any)

    const notified = await sendWorldDigest('campaign-1', [makeChange()], 5)

    expect(notified).toBe(2)
    expect(NotificationService.createNotification).toHaveBeenCalledTimes(2)
    const calls = vi.mocked(NotificationService.createNotification).mock.calls
    expect(calls[0][0].actionUrl).toBe('/campaigns/campaign-1/wiki?type=RUMORS')
    expect(calls[0][0].message).toBe(calls[1][0].message)
    expect(calls[0][0].userId).not.toBe(calls[1][0].userId)
  })

  it('still sends notifications when the journal write fails', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([{ id: 'faction-1' }] as any)
    vi.mocked(prisma.campaignMembership.findMany).mockResolvedValueOnce([{ userId: 'user-1' }] as any)
    vi.mocked(prisma.timelineEvent.createMany).mockRejectedValueOnce(new Error('db down'))

    const notified = await sendWorldDigest('campaign-1', [makeChange()], 5)

    expect(notified).toBe(1)
    expect(NotificationService.createNotification).toHaveBeenCalledTimes(1)
  })

  it('does not notify or journal when there are no campaign members', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([{ id: 'faction-1' }] as any)
    vi.mocked(prisma.campaignMembership.findMany).mockResolvedValueOnce([])

    const result = await sendWorldDigest('campaign-1', [makeChange()], 5)

    expect(result).toBe(0)
    expect(prisma.timelineEvent.createMany).not.toHaveBeenCalled()
  })
})
