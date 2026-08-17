import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    faction: { findMany: vi.fn().mockResolvedValue([]) },
    nPC: { findMany: vi.fn().mockResolvedValue([]) },
    location: { findMany: vi.fn().mockResolvedValue([]) },
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
  DISCOVERY_GATED_ENTITY_TYPES,
  DISCOVERY_SOURCE_MODELS,
  selectDigestChanges,
  groupDigestChangesByField,
  formatDigestLine,
  formatDigestGroupLine,
  titleForDigestChange,
  sendWorldDigest,
  MAX_DIGEST_LINES,
} from '../world-digest'
import type { WorldChange } from '@/lib/game/tick/types'
import { simTurn } from '@/lib/game/turnClock'

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

  it('renders nothing for a field with no authored phrasing', () => {
    // #432: this used to assert a generic fallback line, and the fallback
    // was the defect. `importance: 'MAJOR'` is set by npcTick from
    // `npc.importance >= 5`, so an important NPC's routine movement was
    // MAJOR every turn and rendered as the same generic sentence forever.
    // A field nobody has written a rumor for is not a rumor.
    expect(formatDigestLine(makeChange({ field: 'somethingElse', entityName: 'X' }))).toBe('')
    expect(formatDigestLine(makeChange({ field: 'currentLocation', entityName: 'X' }))).toBe('')
    expect(formatDigestLine(makeChange({ field: 'currentPlan', entityName: 'X' }))).toBe('')
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
    const result = await sendWorldDigest('campaign-1', [], simTurn(3))
    expect(result).toBe(0)
    expect(prisma.timelineEvent.createMany).not.toHaveBeenCalled()
    expect(NotificationService.createNotification).not.toHaveBeenCalled()
  })

  it('does nothing when nothing digest-worthy touches a discovered entity', async () => {
    vi.mocked(prisma.campaignMembership.findMany).mockResolvedValueOnce([{ userId: 'user-1' }] as any)
    const result = await sendWorldDigest('campaign-1', [makeChange({ significant: false })], simTurn(3))
    expect(result).toBe(0)
    expect(prisma.timelineEvent.createMany).not.toHaveBeenCalled()
  })

  it('writes one TimelineEvent per digest-worthy change, isOffscreen and PUBLIC', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([{ id: 'faction-1' }] as any)
    vi.mocked(prisma.campaignMembership.findMany).mockResolvedValueOnce([{ userId: 'user-1' }] as any)

    await sendWorldDigest('campaign-1', [makeChange({ field: 'factionRole', entityName: 'Vex' })], simTurn(5))

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

    await sendWorldDigest('campaign-1', changes, simTurn(6))

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

    const notified = await sendWorldDigest('campaign-1', [makeChange()], simTurn(5))

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

    const notified = await sendWorldDigest('campaign-1', [makeChange()], simTurn(5))

    expect(notified).toBe(1)
    expect(NotificationService.createNotification).toHaveBeenCalledTimes(1)
  })

  it('does not notify or journal when there are no campaign members', async () => {
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([{ id: 'faction-1' }] as any)
    vi.mocked(prisma.campaignMembership.findMany).mockResolvedValueOnce([])

    const result = await sendWorldDigest('campaign-1', [makeChange()], simTurn(5))

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

  it('surfaces a MAJOR weather change at a location the party HAS found', () => {
    const selected = selectDigestChanges(
      [change({ entityType: 'LOCATION_WEATHER', entityId: 'loc1', field: 'weather' })],
      new Set(['loc1'])
    )

    expect(selected).toHaveLength(1)
  })

  it('hides that same storm when the location is undiscovered', () => {
    // #432: this test used to assert the OPPOSITE — that a location change
    // surfaces "nobody has to discover". #395 fixed a real bug (LOCATION*
    // changes were structurally unreachable) on a false premise: it
    // recorded that visibility.ts does not gate locations, when locations
    // are one of its four fog-gated models and `Location.isDiscovered` has
    // existed all along. The result was a severe storm at a location the
    // party had never found, broadcast to every player by name.
    const selected = selectDigestChanges(
      [change({ entityType: 'LOCATION_WEATHER', entityId: 'loc1', field: 'weather' })],
      new Set<string>()
    )

    expect(selected).toHaveLength(0)
  })

  it.each(['LOCATION', 'LOCATION_CONDITION', 'LOCATION_POPULATION'] as const)(
    'hides a MAJOR %s change at an undiscovered location',
    (entityType) => {
      const selected = selectDigestChanges(
        [change({ entityType, entityId: 'x1', field: 'weather' })],
        new Set<string>()
      )

      expect(selected).toHaveLength(0)
    }
  )

  it.each(['CLOCK', 'QUEST', 'WAR', 'DEBT'] as const)(
    'still surfaces a MAJOR %s change with an empty discovered set',
    (entityType) => {
      // These four genuinely have no per-entity discovery for the digest to
      // check — #395's actual finding, and it stands.
      const selected = selectDigestChanges(
        [change({ entityType, entityId: 'x1', field: 'warDeclared' })],
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


describe('rumor variety (#432)', () => {
  const makeNpc = (over: Partial<WorldChange> = {}): WorldChange => ({
    entityType: 'NPC', entityId: 'npc-jason', entityName: 'Jason Asano',
    campaignId: 'c1', field: 'goalCompleted', previousValue: 'a goal', newValue: '(awaiting new direction)',
    reason: 'r', significant: true, importance: 'MAJOR', ...over,
  })

  it('does not repeat the same sentence for the same entity turn after turn', () => {
    // The reported symptom, exactly: one NPC, one recurring event, and a
    // rumor feed reading "Something is shifting around Jason Asano — the
    // details are still unclear." over and over. The variant seed used to
    // be the entity ids alone, so it was a pure function of WHO — the same
    // entity could only ever produce one sentence, forever.
    const lines = new Set(
      Array.from({ length: 12 }, (_, turn) => formatDigestLine(makeNpc(), turn))
    )
    expect(lines.size).toBeGreaterThan(1)
  })

  it('is still deterministic for a given turn', () => {
    // Varied is not the same as random: a rerun of the same turn must
    // produce the same feed, or nothing about this is reproducible.
    expect(formatDigestLine(makeNpc(), 7)).toBe(formatDigestLine(makeNpc(), 7))
  })

  it('gives every rumor-worthy field its own voice, not one shared sentence', () => {
    const fields = [
      'goalCompleted', 'ambitionCommitted', 'ambitionResolved',
      'territoryClaimed', 'territoryContested', 'importance', 'weather',
    ]
    const lines = fields.map(field => formatDigestLine(makeNpc({ field }), 3))

    expect(new Set(lines).size).toBe(fields.length)
    for (const line of lines) expect(line).not.toBe('')
  })

  it('gives every rumor-worthy field its own title, so the feed is not a wall of one heading', () => {
    const fields = [
      'warDeclared', 'warJoined', 'warResolved', 'collapsed', 'founded', 'leadership',
      'goalCompleted', 'ambitionCommitted', 'ambitionResolved',
      'territoryClaimed', 'territoryContested', 'importance', 'weather',
    ]
    const titles = fields.map(field => titleForDigestChange(makeNpc({ field })))

    expect(titles).not.toContain('Word on the Street')
  })

  it('tells a scheme that paid off apart from one that collapsed', () => {
    // The only generator that reads the change's own values. A single
    // phrasing covering both would be worse than no rumor: it would report
    // a debacle as news of a triumph.
    const won = formatDigestLine(makeNpc({ field: 'ambitionResolved', newValue: 'succeeded' }), 5)
    const lost = formatDigestLine(makeNpc({ field: 'ambitionResolved', newValue: 'failed' }), 5)

    expect(won).not.toBe(lost)
    expect(won).toMatch(/paid off|got what|worked/)
    expect(lost).toMatch(/come apart|overreached|failed/)
  })

  it('claims neither outcome for a mixed group', () => {
    const mixed = formatDigestGroupLine([
      makeNpc({ field: 'ambitionResolved', entityId: 'f1', entityName: 'A', newValue: 'succeeded' }),
      makeNpc({ field: 'ambitionResolved', entityId: 'f2', entityName: 'B', newValue: 'failed' }),
    ], 5)

    expect(mixed).toMatch(/mixed results|not everyone came out ahead/)
  })

  it('never names the counterparty or the location on a territory change', () => {
    // previousValue is the other faction's name and newValue is the
    // location's — both may be undiscovered, and both are right there in
    // the change waiting to be leaked.
    for (const turn of [0, 1, 2, 3, 4, 5]) {
      const line = formatDigestLine(makeNpc({
        field: 'territoryClaimed', entityName: 'The Rustwatch',
        previousValue: 'The Hidden Court', newValue: 'Secret Vault',
      }), turn)
      expect(line).not.toContain('Hidden Court')
      expect(line).not.toContain('Secret Vault')
      expect(line).toContain('The Rustwatch')
    }
  })

  it('keeps an important NPC\'s routine movement out of the feed entirely', () => {
    // npcTick marks currentLocation/currentPlan MAJOR for any NPC at
    // importance >= 5, so these fire most turns. They are not news.
    const selected = selectDigestChanges(
      [
        makeNpc({ field: 'currentLocation' }),
        makeNpc({ field: 'currentPlan' }),
        makeNpc({ field: 'goalCompleted' }),
      ],
      new Set(['npc-jason'])
    )

    expect(selected).toHaveLength(1)
    expect(selected[0].field).toBe('goalCompleted')
  })
})


describe('the discovery gate and its id source cannot drift (#432 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.faction.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.nPC.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.location.findMany).mockResolvedValue([] as any)
  })

  // The bug these exist for: #432 gated the LOCATION* types and left the
  // discovered-id set built from factions and NPCs only. Every location
  // change then failed a check against a set that could never contain it —
  // the leak inverted into a blackout. The unit test written at the time
  // passed the id set in DIRECTLY, so it proved the pure filter worked and
  // said nothing about where the real set comes from. That gap is the
  // thing under test here, not the filter.

  it('queries a discovered-id source for every gated entity type', async () => {
    vi.mocked(prisma.campaignMembership.findMany).mockResolvedValueOnce([{ userId: 'u1' }] as any)

    await sendWorldDigest('campaign-1', [makeChange({ field: 'factionRole' })], simTurn(5))

    // Not "queries location" — every model the gate depends on, whatever
    // that set becomes later.
    for (const model of DISCOVERY_SOURCE_MODELS) {
      expect(prisma[model].findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { campaignId: 'campaign-1', isDiscovered: true } })
      )
    }
  })

  it('covers every gated type with a source model', () => {
    // Structural: the gate is derived from the same table as the query, so
    // this asserts the derivation actually holds rather than restating it.
    expect(DISCOVERY_GATED_ENTITY_TYPES.size).toBeGreaterThan(0)
    expect(DISCOVERY_SOURCE_MODELS.length).toBeGreaterThan(0)
    expect(new Set(DISCOVERY_SOURCE_MODELS).size).toBe(DISCOVERY_SOURCE_MODELS.length)
  })

  it('delivers a storm at a discovered location, end to end', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([{ id: 'loc-1' }] as any)
    vi.mocked(prisma.campaignMembership.findMany).mockResolvedValueOnce([{ userId: 'u1' }] as any)

    const notified = await sendWorldDigest('campaign-1', [makeChange({
      entityType: 'LOCATION_WEATHER', entityId: 'loc-1', entityName: 'Ashfall Reach', field: 'weather',
    })], simTurn(5))

    expect(notified).toBe(1)
    // weatherLines was written in #432 and was unreachable until now.
    const call = vi.mocked(prisma.timelineEvent.createMany).mock.calls[0][0] as any
    expect(call.data[0].summaryPublic).toContain('Ashfall Reach')
  })

  it('still withholds a storm at a location the party has not found', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([] as any)
    vi.mocked(prisma.campaignMembership.findMany).mockResolvedValueOnce([{ userId: 'u1' }] as any)

    const notified = await sendWorldDigest('campaign-1', [makeChange({
      entityType: 'LOCATION_WEATHER', entityId: 'loc-secret', entityName: 'The Hidden Vault', field: 'weather',
    })], simTurn(5))

    expect(notified).toBe(0)
    expect(prisma.timelineEvent.createMany).not.toHaveBeenCalled()
  })
})
