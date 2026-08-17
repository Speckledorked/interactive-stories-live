import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    nPC: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    worldEvent: { findMany: vi.fn() },
    worldMeta: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { decideDispositionDrift, parseDisposition, NEUTRAL_DISPOSITION, tickNpcDisposition } from '../npcDispositionTick'
import type { TickContext } from '../types'
import { simTurn } from '@/lib/game/turnClock'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: simTurn(5), factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any, ...overrides }
}

describe('parseDisposition (NPC motivation model)', () => {
  it('parses a fully-shaped vector', () => {
    const raw = { selfPreservation: 60, loyalty: 40, ambition: 55 }
    expect(parseDisposition(raw)).toEqual(raw)
  })

  it('returns null for null/undefined/non-object input', () => {
    expect(parseDisposition(null)).toBeNull()
    expect(parseDisposition(undefined)).toBeNull()
    expect(parseDisposition('not an object')).toBeNull()
  })

  it('returns null when any axis is missing', () => {
    expect(parseDisposition({ selfPreservation: 60, loyalty: 40 })).toBeNull()
  })

  it('returns null when an axis is not a finite number', () => {
    expect(parseDisposition({ selfPreservation: 'high', loyalty: 40, ambition: 55 })).toBeNull()
    expect(parseDisposition({ selfPreservation: NaN, loyalty: 40, ambition: 55 })).toBeNull()
  })

  it('clamps out-of-range values into 0-100', () => {
    const parsed = parseDisposition({ selfPreservation: 150, loyalty: -20, ambition: 55 })
    expect(parsed).toEqual({ selfPreservation: 100, loyalty: 0, ambition: 55 })
  })
})

describe('decideDispositionDrift (NPC motivation model)', () => {
  it('returns the input unchanged when there are no events', () => {
    expect(decideDispositionDrift(NEUTRAL_DISPOSITION, [])).toEqual(NEUTRAL_DISPOSITION)
  })

  // #253 (adversarial audit): decideDispositionDrift is a closed
  // event-kind switch with a fixed, deterministic DRIFT_AMOUNT (4) per
  // event — every one of these can assert the exact resulting value, not
  // just its direction, the same precision the rest of this tick-decider
  // family (factionTick/warTick/beliefTick) already holds itself to. A
  // regression that nudged by the wrong magnitude (e.g. 2 instead of 4)
  // would pass every toBeGreaterThan/toBeLessThan check below unchanged.

  it('being endangered raises selfPreservation only, by exactly one event\'s worth', () => {
    const next = decideDispositionDrift(NEUTRAL_DISPOSITION, [{ kind: 'ENDANGERED' }])
    expect(next).toEqual({ ...NEUTRAL_DISPOSITION, selfPreservation: NEUTRAL_DISPOSITION.selfPreservation + 4 })
  })

  it('being protected lowers selfPreservation and raises loyalty, each by exactly one event\'s worth', () => {
    const next = decideDispositionDrift(NEUTRAL_DISPOSITION, [{ kind: 'PROTECTED' }])
    expect(next).toEqual({
      ...NEUTRAL_DISPOSITION,
      selfPreservation: NEUTRAL_DISPOSITION.selfPreservation - 4,
      loyalty: NEUTRAL_DISPOSITION.loyalty + 4,
    })
  })

  it('the faction winning raises both loyalty and ambition, each by exactly one event\'s worth', () => {
    const next = decideDispositionDrift(NEUTRAL_DISPOSITION, [{ kind: 'FACTION_WON' }])
    expect(next).toEqual({
      ...NEUTRAL_DISPOSITION,
      loyalty: NEUTRAL_DISPOSITION.loyalty + 4,
      ambition: NEUTRAL_DISPOSITION.ambition + 4,
    })
  })

  it('the faction losing lowers loyalty and raises selfPreservation, each by exactly one event\'s worth', () => {
    const next = decideDispositionDrift(NEUTRAL_DISPOSITION, [{ kind: 'FACTION_LOST' }])
    expect(next).toEqual({
      ...NEUTRAL_DISPOSITION,
      loyalty: NEUTRAL_DISPOSITION.loyalty - 4,
      selfPreservation: NEUTRAL_DISPOSITION.selfPreservation + 4,
    })
  })

  it('a wake ripple abandoning them lowers loyalty only, by exactly one event\'s worth', () => {
    const next = decideDispositionDrift(NEUTRAL_DISPOSITION, [{ kind: 'FACTION_ABANDONED_THEM' }])
    expect(next).toEqual({ ...NEUTRAL_DISPOSITION, loyalty: NEUTRAL_DISPOSITION.loyalty - 4 })
  })

  it('a personally achieved goal raises ambition only, by exactly one event\'s worth', () => {
    const next = decideDispositionDrift(NEUTRAL_DISPOSITION, [{ kind: 'GOAL_ACHIEVED' }])
    expect(next).toEqual({ ...NEUTRAL_DISPOSITION, ambition: NEUTRAL_DISPOSITION.ambition + 4 })
  })

  it('folds multiple events in the same batch, each axis summing its own events independently', () => {
    const next = decideDispositionDrift(NEUTRAL_DISPOSITION, [{ kind: 'FACTION_WON' }, { kind: 'FACTION_WON' }, { kind: 'GOAL_ACHIEVED' }])
    // ambition: +4 (1st FACTION_WON) +4 (2nd FACTION_WON) +4 (GOAL_ACHIEVED) = +12
    // loyalty: +4 (1st FACTION_WON) +4 (2nd FACTION_WON) = +8
    expect(next).toEqual({
      ...NEUTRAL_DISPOSITION,
      ambition: NEUTRAL_DISPOSITION.ambition + 12,
      loyalty: NEUTRAL_DISPOSITION.loyalty + 8,
    })
  })

  it('clamps at exactly 100, not beyond, no matter how many events pile up', () => {
    const manyEndangered = Array.from({ length: 50 }, () => ({ kind: 'ENDANGERED' as const }))
    const next = decideDispositionDrift(NEUTRAL_DISPOSITION, manyEndangered)
    expect(next.selfPreservation).toBe(100)
  })

  it('clamps at exactly 0, not below, no matter how many events pile up', () => {
    const manyAbandoned = Array.from({ length: 50 }, () => ({ kind: 'FACTION_ABANDONED_THEM' as const }))
    const next = decideDispositionDrift(NEUTRAL_DISPOSITION, manyAbandoned)
    expect(next.loyalty).toBe(0)
  })
})

describe('tickNpcDisposition (DB handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when the campaign has no major NPCs', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([])
    const result = await tickNpcDisposition(baseCtx())
    expect(result.changes).toEqual([])
    expect(prisma.worldEvent.findMany).not.toHaveBeenCalled()
  })

  it('skips an NPC with no relevant events from the prior turn', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: null, disposition: null, dispositionDriftThroughTurn: null }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([])

    const result = await tickNpcDisposition(baseCtx())

    expect(result.changes).toEqual([])
    // The per-NPC watermark write always happens; what must NOT happen is
    // a disposition write.
    expect(prisma.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1' },
      data: { dispositionDriftThroughTurn: 4 },
    })
  })

  it('never queries faction events for an NPC with no faction', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: null, disposition: null, dispositionDriftThroughTurn: null }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([])

    await tickNpcDisposition(baseCtx())

    expect(prisma.worldEvent.findMany).toHaveBeenCalledTimes(1)
  })

  it('drifts and persists disposition when the NPC was personally endangered', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: null, disposition: null, dispositionDriftThroughTurn: null }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([{ targetId: 'npc1', turnNumber: 11, type: 'npc.consequence', newValue: 'THREATENED' }] as any)

    const result = await tickNpcDisposition(baseCtx())

    expect(prisma.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1' },
      data: expect.objectContaining({ disposition: expect.objectContaining({ selfPreservation: NEUTRAL_DISPOSITION.selfPreservation + 4 })  }),
    })
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({ entityType: 'NPC', entityId: 'npc1', field: 'disposition', significant: false, importance: 'NORMAL' })
  })

  it('drifts disposition when the NPC was favored/protected', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: null, disposition: null, dispositionDriftThroughTurn: null }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([{ targetId: 'npc1', turnNumber: 11, type: 'npc.consequence', newValue: 'FAVORED' }] as any)

    const result = await tickNpcDisposition(baseCtx())

    expect(prisma.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1' },
      data: expect.objectContaining({
        disposition: expect.objectContaining({
          selfPreservation: NEUTRAL_DISPOSITION.selfPreservation - 4,
          loyalty: NEUTRAL_DISPOSITION.loyalty + 4,
        }),
      }),
    })
    expect(result.changes).toHaveLength(1)
  })

  it('an unrecognized consequence action is not classified as endangering or protecting', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: null, disposition: null, dispositionDriftThroughTurn: null }] as any)
    // RECRUITED is a real ConsequenceAction, but here we simulate a
    // completely unrecognized newValue to confirm no drift happens.
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([{ targetId: 'npc1', turnNumber: 11, type: 'npc.consequence', newValue: null }] as any)

    const result = await tickNpcDisposition(baseCtx())

    expect(result.changes).toEqual([])
  })

  it('a personally completed goal raises ambition', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: null, disposition: null, dispositionDriftThroughTurn: null }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([{ targetId: 'npc1', turnNumber: 11, type: 'npc.goalCompleted', newValue: null }] as any)

    const result = await tickNpcDisposition(baseCtx())

    expect(prisma.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1' },
      data: expect.objectContaining({ disposition: expect.objectContaining({ ambition: NEUTRAL_DISPOSITION.ambition + 4 })  }),
    })
    expect(result.changes).toHaveLength(1)
  })

  it('the affiliated faction winning a war raises loyalty and ambition', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: 'f1', disposition: null, dispositionDriftThroughTurn: null }] as any)
    vi.mocked(prisma.worldEvent.findMany)
      .mockResolvedValueOnce([]) // own events
      .mockResolvedValueOnce([{ targetId: 'f1', turnNumber: 11, type: 'faction.warResolved', newValue: 'attacker', origin: 'tick' }] as any) // faction events

    const result = await tickNpcDisposition(baseCtx())

    expect(prisma.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1' },
      data: expect.objectContaining({
        disposition: expect.objectContaining({
          loyalty: NEUTRAL_DISPOSITION.loyalty + 4,
          ambition: NEUTRAL_DISPOSITION.ambition + 4,
        }),
      }),
    })
    expect(result.changes).toHaveLength(1)
  })

  // #445: two queries for the whole roster, not two per NPC. This loop issued
  // a PAIR of worldEvent.findMany per NPC — up to npcCap of each (20 by
  // default, MAX_NPC_CAP of 500) inside the shared 20s tick transaction,
  // every world turn.
  it('reads both event windows once for the whole roster', async () => {
    const roster = Array.from({ length: 10 }, (_, i) => ({
      id: `npc${i}`, name: `NPC ${i}`, factionId: 'f1', disposition: null, dispositionDriftThroughTurn: null,
    }))
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce(roster as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValue([] as any)

    await tickNpcDisposition(baseCtx())

    expect(prisma.worldEvent.findMany).toHaveBeenCalledTimes(2)
  })

  it('skips the faction query entirely when no NPC has a faction', async () => {
    // The per-NPC form had this short-circuit one NPC at a time; the grouped
    // form has to keep it, or an unaffiliated roster pays for a query whose
    // id list is empty.
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([
      { id: 'npc1', name: 'Bram', factionId: null, disposition: null, dispositionDriftThroughTurn: null },
    ] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValue([] as any)

    await tickNpcDisposition(baseCtx())

    expect(prisma.worldEvent.findMany).toHaveBeenCalledTimes(1)
  })

  it('never attributes one NPC\'s events to another', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([
      { id: 'npc1', name: 'Bram', factionId: null, disposition: null, dispositionDriftThroughTurn: null },
      { id: 'npc2', name: 'Sela', factionId: null, disposition: null, dispositionDriftThroughTurn: null },
    ] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValue([
      { targetId: 'npc1', turnNumber: 11, type: 'npc.consequence', newValue: 'THREATENED' },
    ] as any)

    const result = await tickNpcDisposition(baseCtx())

    expect(result.changes.map((c) => c.entityId)).toEqual(['npc1'])
  })

  it('still honours each NPC\'s own watermark, not just the widest', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([
      { id: 'npc1', name: 'Bram', factionId: null, disposition: null, dispositionDriftThroughTurn: null },
      { id: 'npc2', name: 'Sela', factionId: null, disposition: null, dispositionDriftThroughTurn: 11 },
    ] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValue([
      { targetId: 'npc1', turnNumber: 11, type: 'npc.consequence', newValue: 'THREATENED' },
      { targetId: 'npc2', turnNumber: 11, type: 'npc.consequence', newValue: 'THREATENED' },
    ] as any)

    const result = await tickNpcDisposition(baseCtx({ turnNumber: simTurn(13) }))

    expect(result.changes.map((c) => c.entityId)).toEqual(['npc1'])
  })

  it('classifies a stalemate war as no signal', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: 'f1', disposition: null, dispositionDriftThroughTurn: null }] as any)
    vi.mocked(prisma.worldEvent.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ targetId: 'f1', turnNumber: 11, type: 'faction.warResolved', newValue: 'stalemate', origin: 'tick' }] as any)

    const result = await tickNpcDisposition(baseCtx())

    expect(result.changes).toEqual([])
    // The per-NPC watermark write always happens; what must NOT happen is
    // a disposition write.
    expect(prisma.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1' },
      data: { dispositionDriftThroughTurn: 4 },
    })
  })

  it('only treats a faction stability change as abandonment when its origin is wake', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: 'f1', disposition: null, dispositionDriftThroughTurn: null }] as any)
    vi.mocked(prisma.worldEvent.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ targetId: 'f1', turnNumber: 11, type: 'faction.stability', newValue: '45', origin: 'tick' }] as any) // ordinary drift, not a wake ripple

    const result = await tickNpcDisposition(baseCtx())

    expect(result.changes).toEqual([])
  })

  // #310: a genuine NPC-death or faction-collapse wake ripple must still
  // read as abandonment...
  it('treats an NPC-death wake ripple (wakeSourceType NPC) as abandonment', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: 'f1', disposition: null, dispositionDriftThroughTurn: null }] as any)
    vi.mocked(prisma.worldEvent.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ targetId: 'f1', turnNumber: 11, type: 'faction.stability', newValue: '45', origin: 'wake', wakeSourceType: 'NPC' }] as any)

    const result = await tickNpcDisposition(baseCtx())

    expect(prisma.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1' },
      data: expect.objectContaining({ disposition: expect.objectContaining({ loyalty: NEUTRAL_DISPOSITION.loyalty - 4 })  }),
    })
  })

  it('treats a faction-collapse wake ripple (wakeSourceType FACTION) as abandonment', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: 'f1', disposition: null, dispositionDriftThroughTurn: null }] as any)
    vi.mocked(prisma.worldEvent.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ targetId: 'f1', turnNumber: 11, type: 'faction.stability', newValue: '45', origin: 'wake', wakeSourceType: 'FACTION' }] as any)

    const result = await tickNpcDisposition(baseCtx())

    expect(prisma.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1' },
      data: expect.objectContaining({ disposition: expect.objectContaining({ loyalty: NEUTRAL_DISPOSITION.loyalty - 4 })  }),
    })
  })

  // ...but a FACTION_DEFAULT wake (an ally merely defaulting on a bailout
  // loan, economyTick.ts) must NOT — the bug this issue actually names.
  // Before the fix, this indistinguishable-at-the-DB-level shape (same
  // type/field/origin) misread an ally's loan default as the NPC's own
  // faction having abandoned them.
  it('#310: does NOT treat a FACTION_DEFAULT wake ripple as abandonment', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: 'f1', disposition: null, dispositionDriftThroughTurn: null }] as any)
    vi.mocked(prisma.worldEvent.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ targetId: 'f1', turnNumber: 11, type: 'faction.stability', newValue: '45', origin: 'wake', wakeSourceType: 'FACTION_DEFAULT' }] as any)

    const result = await tickNpcDisposition(baseCtx())

    expect(result.changes).toEqual([])
    // The per-NPC watermark write always happens; what must NOT happen is
    // a disposition write.
    expect(prisma.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1' },
      data: { dispositionDriftThroughTurn: 4 },
    })
  })

  it('reads recent turns only, never the full history, for both own and faction events', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: 'f1', disposition: null, dispositionDriftThroughTurn: 10 }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await tickNpcDisposition(baseCtx({ turnNumber: simTurn(12) }))

    for (const call of vi.mocked(prisma.worldEvent.findMany).mock.calls) {
      expect(call[0]).toMatchObject({ where: expect.objectContaining({ turnNumber: { gte: 11, lte: 11 } }) })
    }
  })

  it('catches an NPC up across every turn it missed, not just the last one', async () => {
    // #375: under the campaign-level watermark, an NPC that lost the
    // rotation on turns 2-4 never received those turns' drift and never
    // would. Its own watermark now carries the window forward.
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: null, disposition: null, dispositionDriftThroughTurn: 1 }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([])

    await tickNpcDisposition(baseCtx({ turnNumber: simTurn(5) }))

    expect(vi.mocked(prisma.worldEvent.findMany).mock.calls[0][0]).toMatchObject({
      where: expect.objectContaining({ turnNumber: { gte: 2, lte: 4 } }),
    })
  })

  it('excludes NPCs already current in SQL rather than fetching and skipping them', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([])

    await tickNpcDisposition(baseCtx({ turnNumber: simTurn(5) }))

    const args = vi.mocked(prisma.nPC.findMany).mock.calls[0][0] as any
    expect(args.where.OR).toEqual([
      { dispositionDriftThroughTurn: null },
      { dispositionDriftThroughTurn: { lt: 4 } },
    ])
  })

  it('starts from an existing disposition rather than always from neutral', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([
      { id: 'npc1', name: 'Bram', factionId: null, disposition: { selfPreservation: 90, loyalty: 50, ambition: 50 }, dispositionDriftThroughTurn: null },
    ] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([{ targetId: 'npc1', turnNumber: 11, type: 'npc.consequence', newValue: 'THREATENED' }] as any)

    const result = await tickNpcDisposition(baseCtx())

    expect(prisma.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1' },
      data: expect.objectContaining({ disposition: expect.objectContaining({ selfPreservation: 94 })  }),
    })
    expect(result.changes[0].previousValue).toContain('"selfPreservation":90')
  })

  it('writes nothing in dry-run mode but still reports the changes', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: null, disposition: null, dispositionDriftThroughTurn: null }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([{ targetId: 'npc1', turnNumber: 11, type: 'npc.consequence', newValue: 'THREATENED' }] as any)

    const result = await tickNpcDisposition(baseCtx({ dryRun: true }))

    expect(prisma.nPC.update).not.toHaveBeenCalled()
    expect(result.changes).toHaveLength(1)
  })

  it('queries only major NPCs, restricted to the tick roster, ordered by importance', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([])

    await tickNpcDisposition(
      baseCtx({ roster: { factionIds: [], npcIds: ['npc1', 'npc2'], factionCapHit: false, npcCapHit: false } })
    )

    expect(prisma.nPC.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          campaignId: 'campaign-1',
          isAlive: true,
          importance: { gte: 4 },
          // #375: WHICH NPCs is resolved once per tick and passed in — this
          // handler no longer applies its own take/rotation, because eleven
          // handlers each doing that inside one transaction each selected a
          // different slice.
          id: { in: ['npc1', 'npc2'] },
        }),
        orderBy: [{ importance: 'desc' }, { id: 'asc' }],
      })
    )
    expect((vi.mocked(prisma.nPC.findMany).mock.calls[0][0] as any).take).toBeUndefined()
  })

  it("advances each NPC's own watermark, even when nothing drifted", async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: null, disposition: null, dispositionDriftThroughTurn: null }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([])

    await tickNpcDisposition(baseCtx({ turnNumber: simTurn(5) }))

    expect(prisma.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1' },
      data: { dispositionDriftThroughTurn: 4 },
    })
  })

  it('does not advance any watermark in dry-run mode', async () => {
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Bram', factionId: null, disposition: null, dispositionDriftThroughTurn: null }] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([{ targetId: 'npc1', turnNumber: 11, type: 'npc.consequence', newValue: 'THREATENED' }] as any)

    await tickNpcDisposition(baseCtx({ turnNumber: simTurn(5), dryRun: true }))

    expect(prisma.nPC.update).not.toHaveBeenCalled()
  })
})
