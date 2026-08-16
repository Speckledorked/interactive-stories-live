// src/lib/game/tick/capOrdering.ts
// The per-tick entity roster: which factions and which major NPCs this
// tick simulates, resolved ONCE for the whole tick.
//
// ── Why the cap exists (#283) ─────────────────────────────────────────────
// Every tick handler that reads a slice of a campaign's factions or major
// NPCs used to order that slice by a static key (createdAt asc for
// factions; importance desc for the NPC handlers) with take: cap. A static
// key means the SAME cutoff wins every single tick forever — the newest
// entities (including the splinter/succession factions the simulation
// itself spawns via absorption/collapse) never get simulated once a
// campaign's roster exceeds its cap, permanently and silently.
//
// Faction.lastTickedAt / NPC.lastTickedAt fix that: nullable (null =
// "never ticked", sorts first, maximally overdue), ordered ascending, and
// bumped for whatever was actually selected. Over successive ticks the
// whole roster rotates through the cap.
//
// ── Why it is resolved here and not per handler (#375) ────────────────────
// The rotation was originally applied INSIDE each handler: every one
// appended the rotation key to its own orderBy and bumped lastTickedAt for
// its own selection, immediately after its capped query, with ctx.db —
// the TRANSACTION client — before doing any work.
//
// Prisma interactive transactions are read-your-own-writes. So handler N+1
// saw handler N's bump and selected a DIFFERENT slice, inside the same
// transaction. With 25 factions and a cap of 10: relationships took 1-10
// and stamped them; belief drift then saw 11-25 sorting first and took
// 11-20; goal reassessment took 21-25 plus five of 1-10. Every subsequent
// handler landed on another slice.
//
// That dissolved the same-tick ordering chain worldTick.ts's header comment
// exists to protect — relationships → goal reassessment → leadership →
// wars all read state the previous link never wrote this turn. It also
// broke determinism (new Date() became the selection key for every capped
// query) and made dry-run diverge from the real tick, since the bumps are
// skipped in a preview and all handlers therefore agreed there.
//
// Resolving the roster once and passing it through TickContext fixes all
// three at once: every handler simulates the SAME entities, selection is a
// pure function of DB state, and a preview selects what the real tick will.
//
// Handlers now filter with `id: { in: ctx.roster.factionIds }` and keep
// whatever additional predicates they need. They must NOT re-apply take or
// a rotation orderBy — see __tests__/capOrdering.convention.test.ts, which
// fails the build if one does.

import type { Prisma } from '@prisma/client'

/**
 * The rotation sort key. `id` is a deterministic tiebreak: without it,
 * entities sharing a lastTickedAt (the common case — a whole roster bumped
 * by one updateMany shares a timestamp to the millisecond) come back in
 * whatever order Postgres happens to scan, so the selected slice could
 * differ between two runs against identical state.
 */
export const TICK_ROTATION_ORDER = [
  { lastTickedAt: { sort: 'asc' as const, nulls: 'first' as const } },
  { id: 'asc' as const },
]

/**
 * NPC handlers keep importance as their PRIMARY key — that is an
 * intentional priority ("simulate the NPCs who matter first"), not the bug
 * the rotation fixes. Rotation only breaks ties among equally-important
 * NPCs, so a large low-importance roster no longer starves behind a stable
 * head forever.
 */
export const NPC_TICK_ROTATION_ORDER = [
  { importance: 'desc' as const },
  ...TICK_ROTATION_ORDER,
]

/**
 * The entities this tick simulates. Every handler reads from this rather
 * than running its own capped query.
 *
 * `factionCapHit` / `npcCapHit` record whether the cap actually truncated
 * the roster. Handlers that advance a "processed through turn N" watermark
 * need to know: marking a turn fully processed when only a capped subset of
 * the roster was looked at is precisely how drift used to be lost forever.
 */
export interface TickRoster {
  factionIds: string[]
  npcIds: string[]
  factionCapHit: boolean
  npcCapHit: boolean
}

/**
 * The narrow client surface this needs. Structural rather than the full
 * PrismaClient so a test can hand it two stub functions, and `any` in the
 * argument position because Prisma's generated `findMany` overloads are
 * generic over their own args type and won't unify with a hand-written
 * signature.
 */
interface RosterDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  faction: { findMany: (args: any) => Promise<Array<{ id: string }>> }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nPC: { findMany: (args: any) => Promise<Array<{ id: string }>> }
}

/**
 * Resolve this tick's roster. Called once, at the top of runWorldTick,
 * before the handler pass — and notably before the transaction opens, so
 * it reads committed state rather than anything the tick itself wrote.
 *
 * The predicates here must stay in sync with what the handlers expect:
 * active factions, and living NPCs at or above the major-importance
 * threshold. Handlers may narrow further (ambitionTick only cares about
 * three goals) but must not widen.
 */
export async function resolveTickRoster(
  db: RosterDb,
  opts: {
    campaignId: string
    factionCap: number
    npcCap: number
    npcImportanceThreshold: number
  }
): Promise<TickRoster> {
  const [factions, npcs] = await Promise.all([
    db.faction.findMany({
      where: { campaignId: opts.campaignId, isActive: true },
      orderBy: TICK_ROTATION_ORDER,
      take: opts.factionCap,
      select: { id: true },
    }),
    db.nPC.findMany({
      where: {
        campaignId: opts.campaignId,
        isAlive: true,
        importance: { gte: opts.npcImportanceThreshold },
      },
      orderBy: NPC_TICK_ROTATION_ORDER,
      take: opts.npcCap,
      select: { id: true },
    }),
  ])

  return {
    factionIds: factions.map((f) => f.id),
    npcIds: npcs.map((n) => n.id),
    // take: N returning exactly N is the signal that there may be more —
    // one extra count query per tick to distinguish "exactly at the cap"
    // from "truncated" is not worth it, and erring toward "truncated" is
    // the safe direction for every consumer (a watermark that advances one
    // tick later than it could is harmless; one that advances too early
    // loses drift permanently).
    factionCapHit: factions.length >= opts.factionCap,
    npcCapHit: npcs.length >= opts.npcCap,
  }
}

/**
 * The `where` fragment a handler spreads into its faction query to restrict
 * itself to this tick's roster.
 *
 * Returns an empty predicate when no roster is present — a single-handler
 * unit test with a mocked client, where the mock's return value IS the
 * intended input. runWorldTick always supplies a roster, so the empty case
 * never happens in production. Deliberately NOT a fallback to a
 * per-handler capped query: that is the defect this replaces.
 */
export function rosterFactionFilter(ctx: { roster?: TickRoster }): { id?: { in: string[] } } {
  return ctx.roster ? { id: { in: ctx.roster.factionIds } } : {}
}

/** The NPC counterpart of rosterFactionFilter. */
export function rosterNpcFilter(ctx: { roster?: TickRoster }): { id?: { in: string[] } } {
  return ctx.roster ? { id: { in: ctx.roster.npcIds } } : {}
}

/**
 * Bump the rotation key for everything this tick simulated — ONCE, after
 * every handler has run, with a single timestamp.
 *
 * Called with the transaction client from inside the tick transaction so
 * the bump commits or rolls back with the turn it describes: a tick that
 * fails must not claim to have simulated anyone, or those entities lose
 * their place in the rotation for a turn that never happened.
 *
 * `at` is captured at tick start and passed in rather than read from the
 * clock here, so the tick contains no wall-clock read that could affect
 * its own outcome.
 */
export async function markRosterTicked(
  db: Prisma.TransactionClient,
  roster: TickRoster,
  at: Date
): Promise<void> {
  await Promise.all([
    roster.factionIds.length > 0
      ? db.faction.updateMany({ where: { id: { in: roster.factionIds } }, data: { lastTickedAt: at } })
      : Promise.resolve(),
    roster.npcIds.length > 0
      ? db.nPC.updateMany({ where: { id: { in: roster.npcIds } }, data: { lastTickedAt: at } })
      : Promise.resolve(),
  ])
}
