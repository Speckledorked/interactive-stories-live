// src/lib/game/tick/__tests__/warAttritionAccumulates.test.ts
//
// #510 — attrition arithmetic is per FACTION, not per WAR.
//
// resolveWarProgress used to write each participant's post-attrition
// resources/military inside the war loop, computing every new value from
// `p.faction.resources` — the snapshot loaded once, before the loop, with
// `activeWars`. Two wars in one tick therefore both subtracted from the
// SAME starting number: the second faction.update overwrote the first, so
// a faction fighting on two fronts paid one front's attrition. The emitted
// WorldChange carried the same flaw, two rows both claiming the identical
// `previousValue`, which is what npcDispositionTick's treasury-collapse
// classifier reads.
//
// The bug is unreachable through the simulation itself — `factionIdsAtWar`
// gates coalition joining AND both sides of a new declaration, so nobody is
// ever in two ESCALATING wars at once. That invariant is pinned by its own
// test at the bottom of this file, because it is the thing standing between
// the old arithmetic and a wrong number, and nothing said so.
//
// Both halves are kept deliberately. The invariant test says what the
// simulation guarantees today; the accumulation tests say the arithmetic is
// right even if that guarantee is ever relaxed — a war seeded by an admin
// tool, a fixture, or a future rule that lets a great power fight two
// neighbours at once. One pins intent, the other removes the dependency.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    war: { findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    faction: { update: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    location: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    warParticipant: { create: vi.fn(), createMany: vi.fn() },
    supplyRoute: { findMany: vi.fn() },
    nPC: { findMany: vi.fn(async () => []) },
    factionDebt: { findMany: vi.fn(async () => []) },
  },
}))

import { prisma } from '@/lib/prisma'
import { tickWars } from '../warTick'
import type { TickContext } from '../types'
import { factionTieRows } from './tieFixtures'
import { simTurn } from '@/lib/game/turnClock'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return {
    campaignId: 'campaign-1',
    turnNumber: simTurn(5),
    factionCap: 10,
    npcCap: 20,
    dryRun: false,
    db: prisma as any,
    ...overrides,
  }
}

function makeFaction(id: string, overrides: Record<string, any> = {}) {
  const { ties, ...rest } = overrides
  return {
    id,
    name: id,
    resources: 50,
    stability: 50,
    military: 50,
    influence: 50,
    isActive: true,
    ...factionTieRows(id, ties ?? {}),
    ...rest,
  }
}

function makeParticipant(warId: string, factionId: string, side: 'ATTACKER' | 'DEFENDER', faction: any) {
  return { id: `${warId}-${factionId}`, warId, factionId, side, joinedTurn: 1, faction }
}

function makeWar(id: string, attacker: any, defender: any, extraParticipants: any[] = []) {
  return {
    id,
    campaignId: 'campaign-1',
    name: `War ${id}`,
    attackerFactionId: attacker.id,
    defenderFactionId: defender.id,
    contestedLocationId: null,
    momentum: 0,
    startedTurn: 1,
    attacker,
    defender,
    participants: [
      makeParticipant(id, attacker.id, 'ATTACKER', attacker),
      makeParticipant(id, defender.id, 'DEFENDER', defender),
      ...extraParticipants,
    ],
  }
}

/** The faction.update carrying attrition (resources/military) for `id`. */
function attritionWriteFor(id: string) {
  return vi
    .mocked(prisma.faction.update)
    .mock.calls.filter((c) => (c[0] as any).where.id === id && (c[0] as any).data.resources !== undefined)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.faction.findMany).mockResolvedValue([])
  vi.mocked(prisma.location.findMany).mockResolvedValue([])
  vi.mocked(prisma.supplyRoute.findMany).mockResolvedValue([])
})

describe('war attrition accumulates per faction across wars', () => {
  it('charges a two-front faction both wars, from one base, in one write', async () => {
    // `twoFront` is the ATTACKER in war-1 and the DEFENDER in war-2, so it
    // is hit by both sides' delta — the exact shape that used to
    // last-write-wins.
    const twoFront = makeFaction('two-front', { resources: 50, military: 50 })
    const defenderA = makeFaction('def-a', { resources: 50, military: 50 })
    const attackerB = makeFaction('att-b', { resources: 50, military: 50 })

    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([
      makeWar('war-1', twoFront, defenderA),
      makeWar('war-2', attackerB, twoFront),
    ] as any)

    await tickWars(baseCtx({ turnNumber: simTurn(2) }))

    const writes = attritionWriteFor('two-front')
    // One write, not one per war — N writes against the same base is the
    // bug, and "the last one wins" is what made it silent.
    expect(writes).toHaveLength(1)

    const { resources, military } = (writes[0][0] as any).data
    // ATTRITION_RESOURCES is 3 a side per war; two wars is 6 off a base of
    // 50. The point is 44, not 47: 47 is what one war costs, and what the
    // old code wrote twice.
    expect(resources).toBe(44)
    // ATTRITION_MILITARY is 2 a side per war, with no weather/ruin/supply
    // modifiers in this fixture.
    expect(military).toBe(46)
  })

  it('reports the true previous and new value in the single WorldChange', async () => {
    const twoFront = makeFaction('two-front', { resources: 50, military: 50 })
    const defenderA = makeFaction('def-a', { resources: 50, military: 50 })
    const attackerB = makeFaction('att-b', { resources: 50, military: 50 })

    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([
      makeWar('war-1', twoFront, defenderA),
      makeWar('war-2', attackerB, twoFront),
    ] as any)

    const result = await tickWars(baseCtx({ turnNumber: simTurn(2) }))

    // npcDispositionTick's treasury-collapse classifier reads the band
    // transition across previousValue -> newValue, so two rows each
    // claiming 50 -> 47 misreport a faction that actually went 50 -> 44.
    const resourceChanges = result.changes.filter(
      (c) => c.entityId === 'two-front' && c.field === 'resources'
    )
    expect(resourceChanges).toHaveLength(1)
    expect(resourceChanges[0]).toMatchObject({ previousValue: 50, newValue: 44 })
  })

  it('still emits one change per participant when each fights a single war', async () => {
    // The ordinary case must not regress into one row for the whole tick.
    const attackerA = makeFaction('att-a')
    const defenderA = makeFaction('def-a')
    const attackerB = makeFaction('att-b')
    const defenderB = makeFaction('def-b')

    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([
      makeWar('war-1', attackerA, defenderA),
      makeWar('war-2', attackerB, defenderB),
    ] as any)

    const result = await tickWars(baseCtx({ turnNumber: simTurn(2) }))

    const ids = result.changes.filter((c) => c.field === 'resources').map((c) => c.entityId).sort()
    expect(ids).toEqual(['att-a', 'att-b', 'def-a', 'def-b'])
    for (const id of ids) expect(attritionWriteFor(id)).toHaveLength(1)
  })

  it('writes nothing on a dry run but still reports the accumulated change', async () => {
    // Every other change this handler emits is produced outside the dryRun
    // guard; moving the emission after the loop must not quietly change
    // that, or a dry run stops reporting what a real tick would do.
    const twoFront = makeFaction('two-front', { resources: 50, military: 50 })
    const defenderA = makeFaction('def-a')
    const attackerB = makeFaction('att-b')

    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([
      makeWar('war-1', twoFront, defenderA),
      makeWar('war-2', attackerB, twoFront),
    ] as any)

    const result = await tickWars(baseCtx({ turnNumber: simTurn(2), dryRun: true }))

    expect(attritionWriteFor('two-front')).toHaveLength(0)
    expect(
      result.changes.find((c) => c.entityId === 'two-front' && c.field === 'resources')
    ).toMatchObject({ previousValue: 50, newValue: 44 })
  })

  it('clamps the accumulated total at zero rather than each war separately', async () => {
    // Two wars off a base of 4 is -6. Clamping per war would floor at 1
    // twice and write 1; clamping the accumulated delta once floors at 0.
    const twoFront = makeFaction('two-front', { resources: 4, military: 3 })
    const defenderA = makeFaction('def-a')
    const attackerB = makeFaction('att-b')

    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([
      makeWar('war-1', twoFront, defenderA),
      makeWar('war-2', attackerB, twoFront),
    ] as any)

    await tickWars(baseCtx({ turnNumber: simTurn(2) }))

    const { resources, military } = (attritionWriteFor('two-front')[0][0] as any).data
    expect(resources).toBe(0)
    expect(military).toBe(0)
  })
})

describe('the invariant the accumulation no longer depends on', () => {
  it('passes over a stronger ally that is already fighting, and takes the free one', async () => {
    // `factionIdsAtWar` is built from every participant of every ESCALATING
    // war before anything else runs, and gates the coalition pass. The
    // fixture makes the gate the ONLY thing separating the two candidates:
    // both are ALLY ties of the same belligerent, both clear every
    // eligibility bar, and decideWarJoiner sorts by military descending
    // with MAX_JOINERS_PER_SIDE_PER_TICK of 1 — so the stronger one wins
    // unless something excludes it. `busy-ally` is the stronger one AND is
    // already a participant in war-2. Drop the factionIdsAtWar check from
    // growWarCoalitions and this flips to busy-ally, which is the whole
    // point: without the gate a faction ends the tick in two wars.
    const attackerA = makeFaction('att-a', {
      military: 60,
      ties: { 'busy-ally': { type: 'ALLY', since: 1 }, 'free-ally': { type: 'ALLY', since: 1 } },
    })
    const defenderA = makeFaction('def-a', { military: 60 })
    const busyAlly = makeFaction('busy-ally', { military: 90 })
    const freeAlly = makeFaction('free-ally', { military: 70 })
    const itsOwnEnemy = makeFaction('its-own-enemy', { military: 60 })

    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([
      makeWar('war-1', attackerA, defenderA),
      makeWar('war-2', busyAlly, itsOwnEnemy),
    ] as any)

    // The coalition pass looks candidates up by id; declareNewWars sweeps
    // the whole roster. Only the first should return anything here.
    vi.mocked(prisma.faction.findMany).mockImplementation((async (args: any) => {
      if (!args?.where?.id?.in) return [] as any
      const byId: Record<string, any> = { 'busy-ally': busyAlly, 'free-ally': freeAlly }
      return args.where.id.in
        .map((id: string) => byId[id])
        .filter(Boolean)
        .map((f: any) => ({ id: f.id, name: f.name, military: f.military, influence: f.influence })) as any
    }) as any)

    await tickWars(baseCtx({ turnNumber: simTurn(2) }))

    const joinedIds = vi
      .mocked(prisma.warParticipant.create)
      .mock.calls.map((c) => (c[0] as any).data.factionId)

    expect(joinedIds).toContain('free-ally')
    expect(joinedIds).not.toContain('busy-ally')
  })
})
