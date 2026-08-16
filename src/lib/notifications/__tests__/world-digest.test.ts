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
  groupDigestChangesByField,
  formatDigestLine,
  formatDigestGroupLine,
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

  it('does not cap the raw selection — capping now happens after grouping, in groupDigestChangesByField', () => {
    const discovered = new Set(['faction-1'])
    const changes = Array.from({ length: MAX_DIGEST_LINES + 5 }, () => makeChange())
    expect(selectDigestChanges(changes, discovered)).toHaveLength(MAX_DIGEST_LINES + 5)
  })
})

describe('groupDigestChangesByField', () => {
  it('collapses multiple changes sharing a field into one group instead of one group each', () => {
    const changes = [
      makeChange({ entityType: 'NPC', field: 'factionRole', entityId: 'npc-1', entityName: 'Alayne Voss' }),
      makeChange({ entityType: 'NPC', field: 'factionRole', entityId: 'npc-2', entityName: 'Jorin Pell' }),
      makeChange({ entityType: 'NPC', field: 'factionRole', entityId: 'npc-3', entityName: 'Hale Renn' }),
    ]
    const groups = groupDigestChangesByField(changes)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(3)
  })

  it('caps the number of GROUPS at MAX_DIGEST_LINES, preserving first-seen field order', () => {
    const fields = ['warDeclared', 'warJoined', 'collapsed', 'founded', 'factionRole', 'somethingElse']
    const changes = fields.map(field => makeChange({ field, entityId: field, entityName: field }))
    const groups = groupDigestChangesByField(changes)
    expect(groups).toHaveLength(MAX_DIGEST_LINES)
    expect(groups.map(g => g[0].field)).toEqual(fields.slice(0, MAX_DIGEST_LINES))
  })

  it('a burst of same-field changes no longer crowds out a different field from the same turn', () => {
    // The exact bug this guards against: 3 factions settling new
    // leadership in one tick used to consume the entire MAX_DIGEST_LINES
    // budget on 3 near-identical lines, leaving no room for anything else
    // that happened the same turn.
    const changes = [
      makeChange({ entityType: 'NPC', field: 'factionRole', entityId: 'npc-1', entityName: 'Alayne Voss' }),
      makeChange({ entityType: 'NPC', field: 'factionRole', entityId: 'npc-2', entityName: 'Jorin Pell' }),
      makeChange({ entityType: 'NPC', field: 'factionRole', entityId: 'npc-3', entityName: 'Hale Renn' }),
      makeChange({ field: 'warDeclared', entityId: 'faction-2', entityName: 'The Iron Concord' }),
    ]
    const groups = groupDigestChangesByField(changes)
    expect(groups).toHaveLength(2)
    expect(groups.map(g => g[0].field)).toEqual(['factionRole', 'warDeclared'])
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
    expect(line).toContain('Vex')
    expect(line).toContain('new leadership')
    expect(line).not.toContain('talk of upheaval')
  })

  it('still recognizes the literal leader/leadership field names', () => {
    expect(formatDigestLine(makeChange({ field: 'leader', entityName: 'X' }))).toContain('new leadership')
    expect(formatDigestLine(makeChange({ field: 'leadership', entityName: 'X' }))).toContain('new leadership')
  })

  it('falls back to the generic line for an unrecognized field', () => {
    expect(formatDigestLine(makeChange({ field: 'somethingElse', entityName: 'X' }))).toContain('X')
  })

  it('varies phrasing across different entities so the same event type does not read identically every time', () => {
    // The actual bug report this guards against: three factions settling
    // new leadership in one tick produced three lines that were byte-
    // identical except for the name.
    const names = ['Alayne Voss', 'Jorin Pell', 'Hale Renn', 'Surveyor Renn', 'Foreman Quinn', 'Dara Ashe']
    const lines = new Set(names.map(n => formatDigestLine(makeChange({ field: 'factionRole', entityName: n, entityId: n }))))
    expect(lines.size).toBeGreaterThan(1)
  })

  it('is deterministic — the same change always renders the same line', () => {
    const a = formatDigestLine(makeChange({ field: 'factionRole', entityName: 'Vex', entityId: 'npc-vex' }))
    const b = formatDigestLine(makeChange({ field: 'factionRole', entityName: 'Vex', entityId: 'npc-vex' }))
    expect(a).toBe(b)
  })
})

describe('formatDigestGroupLine', () => {
  it('combines multiple same-field changes into one line naming every entity', () => {
    const changes = [
      makeChange({ entityType: 'NPC', field: 'factionRole', entityId: 'npc-1', entityName: 'Alayne Voss' }),
      makeChange({ entityType: 'NPC', field: 'factionRole', entityId: 'npc-2', entityName: 'Jorin Pell' }),
      makeChange({ entityType: 'NPC', field: 'factionRole', entityId: 'npc-3', entityName: 'Hale Renn' }),
    ]
    const line = formatDigestGroupLine(changes)
    expect(line).toContain('Alayne Voss')
    expect(line).toContain('Jorin Pell')
    expect(line).toContain('Hale Renn')
    expect(line).toContain('new leadership')
  })

  it('matches formatDigestLine for a single-change group', () => {
    const change = makeChange({ field: 'factionRole', entityName: 'Vex', entityId: 'npc-vex' })
    expect(formatDigestGroupLine([change])).toBe(formatDigestLine(change))
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
      isOffscreen: true,
      visibility: 'PUBLIC',
      eventType: 'WORLD_EVENT',
    })
    expect(call.data[0].summaryPublic).toContain('Vex')
    expect(call.data[0].summaryPublic).toContain('new leadership')
  })

  it('collapses multiple changes sharing a field into a single combined TimelineEvent, not one per change', async () => {
    // The exact bug reported live: 3 factions settling new leadership in
    // one tick produced 3 separate, near-identical "New Leadership"
    // rumors instead of one.
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([
      { id: 'npc-1' },
      { id: 'npc-2' },
      { id: 'npc-3' },
    ] as any)
    vi.mocked(prisma.campaignMembership.findMany).mockResolvedValueOnce([{ userId: 'user-1' }] as any)

    const changes = [
      makeChange({ entityType: 'NPC', field: 'factionRole', entityId: 'npc-1', entityName: 'Alayne Voss' }),
      makeChange({ entityType: 'NPC', field: 'factionRole', entityId: 'npc-2', entityName: 'Jorin Pell' }),
      makeChange({ entityType: 'NPC', field: 'factionRole', entityId: 'npc-3', entityName: 'Hale Renn' }),
    ]

    await sendWorldDigest('campaign-1', changes, 6)

    expect(prisma.timelineEvent.createMany).toHaveBeenCalledTimes(1)
    const call = vi.mocked(prisma.timelineEvent.createMany).mock.calls[0][0] as any
    expect(call.data).toHaveLength(1)
    expect(call.data[0].summaryPublic).toContain('Alayne Voss')
    expect(call.data[0].summaryPublic).toContain('Jorin Pell')
    expect(call.data[0].summaryPublic).toContain('Hale Renn')
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

// ---------------------------------------------------------------------------
// #395: types with no discovery concept were being treated as undiscovered
// ---------------------------------------------------------------------------
//
// The gate tested `discoveredEntityIds.has(c.entityId)` for every change,
// and the set was built from faction and NPC ids only — so LOCATION_WEATHER,
// LOCATION_CONDITION, LOCATION_POPULATION, CLOCK, QUEST, WAR, CHARACTER,
// DEBT and LOCATION ids could never be in it. Nine entity types were
// STRUCTURALLY unreachable: weatherTick emits storms flagged MAJOR, and
// they were computed, logged to WorldEvent, and silently dropped.

describe('selectDigestChanges — discovery is per entity TYPE (#395)', () => {
  const change = (over: Partial<WorldChange>): WorldChange => ({
    entityType: 'FACTION', entityId: 'f1', entityName: 'The Rustwatch',
    campaignId: 'c1', field: 'stability', previousValue: 50, newValue: 20,
    reason: 'r', significant: true, importance: 'MAJOR', ...over,
  })

  it('surfaces a MAJOR location weather change nobody has to discover', () => {
    const selected = selectDigestChanges(
      [change({ entityType: 'LOCATION_WEATHER', entityId: 'loc1', field: 'weather' })],
      new Set<string>()
    )

    expect(selected).toHaveLength(1)
  })

  it.each(['CLOCK', 'QUEST', 'WAR', 'DEBT', 'LOCATION', 'LOCATION_CONDITION'] as const)(
    'surfaces a MAJOR %s change with an empty discovered set',
    (entityType) => {
      const selected = selectDigestChanges(
        [change({ entityType, entityId: 'x1' })],
        new Set<string>()
      )

      expect(selected).toHaveLength(1)
    }
  )

  it('still hides an undiscovered faction', () => {
    // The gate is narrower, not gone: types that DO model discovery are
    // still checked.
    const selected = selectDigestChanges([change({ entityType: 'FACTION', entityId: 'f1' })], new Set<string>())

    expect(selected).toEqual([])
  })

  it('still hides an undiscovered NPC', () => {
    const selected = selectDigestChanges([change({ entityType: 'NPC', entityId: 'n1' })], new Set<string>())

    expect(selected).toEqual([])
  })

  it('still requires MAJOR and significant', () => {
    expect(selectDigestChanges([change({ entityType: 'CLOCK', importance: 'NORMAL' })], new Set())).toEqual([])
    expect(selectDigestChanges([change({ entityType: 'CLOCK', significant: false })], new Set())).toEqual([])
  })
})
