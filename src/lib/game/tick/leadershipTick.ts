// src/lib/game/tick/leadershipTick.ts
// World Sim Phase 4 — automatic faction leadership succession.
//
// A faction's LEADER can go missing (killed, marked no longer alive by a
// GM) without any single well-defined "succession" event to hook into —
// NPC death isn't currently a structured trigger point the way clock
// completion or faction collapse are. So instead of reacting to a death
// event, this runs every tick and simply ensures an invariant holds: a
// faction with any living affiliated members has exactly one living
// LEADER. If it doesn't, the most important living member steps up.
// Idempotent — a faction that already has a living leader is untouched, so
// this reads as "keep this true" rather than "something just happened."
//
// World Sim Phase 6 — a faction with a player character as its leader
// (Faction.leaderCharacterId) is skipped entirely: an NPC never gets
// auto-promoted over a player, even if every affiliated NPC member outranks
// them in importance. The player's leadership isn't a gap to fill.

import { TickContext, TickHandlerResult, WorldChange, clamp } from './types'

/** One living, affiliated NPC considered for promotion. */
export interface SuccessionCandidate {
  id: string
  name: string
  importance: number
  factionRole: 'LEADER' | 'MEMBER' | null
}

export interface SuccessionDecision {
  successorId: string
  successorName: string
  /** The role they actually held, for an honest history entry. */
  previousRole: string
  reason: string
  /** #112: 0-1, how contested this transition was — multiple near-tied
   * candidates competing for the seat, and/or a faction already
   * destabilized when its leader was lost, make for a rougher transition
   * than a lone obvious heir stepping up in an otherwise-stable faction.
   * Reused by #103 (Wake) instead of computing "how bad was this
   * transition" a second, separate way. */
  successionRoughness: number
}

const NEUTRAL_STABILITY = 50
const CONTEST_IMPORTANCE_GAP = 1

/**
 * Pure, no DB access. Two independent contributors, averaged:
 * - contest: the fraction of OTHER living members whose importance is
 *   within CONTEST_IMPORTANCE_GAP of the successor's — a crowded near-tie
 *   is a rougher transition than an obvious single heir with no real
 *   competition.
 * - instability: how far below full stability the faction already was when
 *   it lost its leader — losing a leader while already destabilized is
 *   rougher than a clean handoff in an otherwise-healthy faction.
 */
function computeSuccessionRoughness(
  members: SuccessionCandidate[],
  successor: SuccessionCandidate,
  stability: number | undefined
): number {
  const successorImportance = Number.isFinite(Number(successor.importance)) ? Number(successor.importance) : 0
  const others = members.filter(m => m.id !== successor.id)
  const contested = others.filter(m => {
    const importance = Number.isFinite(Number(m.importance)) ? Number(m.importance) : 0
    return importance >= successorImportance - CONTEST_IMPORTANCE_GAP
  })
  const contestFraction = others.length > 0 ? contested.length / others.length : 0

  const effectiveStability = Number.isFinite(Number(stability)) ? Number(stability) : NEUTRAL_STABILITY
  const instability = clamp((100 - effectiveStability) / 100, 0, 1)

  return clamp((contestFraction + instability) / 2, 0, 1)
}

/**
 * Who, if anyone, steps up to lead this faction.
 *
 * Extracted as a pure function (#97) because this was the only tick module
 * with no testable form: the whole rule lived inline in the DB handler
 * below, so succession — named in the README's faction-simulation row —
 * was the one simulation rule with no test at all. Every other handler in
 * this directory has a `decide*` counterpart; this is that.
 *
 * Sorting happens HERE rather than being inherited from the query's
 * `orderBy`, so the decision is a function of its arguments and nothing
 * else. That also fixes a real determinism gap: `orderBy: { importance:
 * 'desc' }` leaves ties to whatever order Postgres returns rows in, so two
 * equally important lieutenants could promote differently on identical
 * data. This engine avoids that everywhere else (see `stableHash` in
 * types.ts) and it should not have been the exception.
 *
 * Returns null when the invariant already holds, which is most factions on
 * most ticks — this handler reads as "keep this true", not "react to a
 * death".
 */
export function decideSuccession(faction: {
  name: string
  leaderCharacterId: string | null
  /** Living affiliated members only. */
  members: SuccessionCandidate[]
  /** #112: the faction's stability at the moment its leader was lost.
   * Optional — falls back to NEUTRAL_STABILITY when omitted, so existing
   * callers that don't track it here still get a sane roughness estimate
   * from contest alone. */
  stability?: number
}): SuccessionDecision | null {
  // A player character leading is not a gap to fill. No NPC is promoted
  // over a player, however important they are.
  if (faction.leaderCharacterId) return null

  const members = Array.isArray(faction.members) ? faction.members : []
  if (members.length === 0) return null

  // Idempotent: a faction that already has a living leader is untouched.
  if (members.some(m => m.factionRole === 'LEADER')) return null

  const successor = [...members].sort(compareCandidates)[0]

  return {
    successorId: successor.id,
    successorName: successor.name,
    // The real role, not a hardcoded 'MEMBER'. factionRole is nullable, so
    // an unranked member would otherwise be recorded in campaign history as
    // having lost a role they never held.
    previousRole: successor.factionRole ?? 'none',
    reason: `${successor.name} steps up to lead ${faction.name}`,
    successionRoughness: computeSuccessionRoughness(members, successor, faction.stability),
  }
}

/**
 * Most important first, then by name, then by id.
 *
 * The name tiebreak is deliberate rather than jumping straight to id: it
 * makes the outcome explicable to a host reading the history ("the
 * next-ranked member, alphabetically") instead of turning on an opaque
 * cuid. Id is the final backstop so the order is total.
 */
function compareCandidates(a: SuccessionCandidate, b: SuccessionCandidate): number {
  const importanceA = Number.isFinite(Number(a.importance)) ? Number(a.importance) : 0
  const importanceB = Number.isFinite(Number(b.importance)) ? Number(b.importance) : 0
  if (importanceA !== importanceB) return importanceB - importanceA
  const byName = (a.name ?? '').localeCompare(b.name ?? '')
  if (byName !== 0) return byName
  return (a.id ?? '').localeCompare(b.id ?? '')
}

export async function tickFactionLeadership(ctx: TickContext): Promise<TickHandlerResult> {
  const factions = await ctx.db.faction.findMany({
    where: { campaignId: ctx.campaignId, isActive: true },
    orderBy: { createdAt: 'asc' },
    take: ctx.factionCap,
    include: {
      members: {
        where: { isAlive: true },
        // Kept for query stability; decideSuccession sorts independently, so
        // the outcome no longer depends on the order rows come back in.
        orderBy: { importance: 'desc' },
      },
    },
    // stability is a real column on Faction already selected by default
    // (include doesn't restrict scalar fields) — called out here (#112)
    // only because decideSuccession's roughness computation now depends on
    // it reaching that call unchanged.
  })

  const changes: WorldChange[] = []

  for (const faction of factions) {
    const decision = decideSuccession(faction)
    if (!decision) continue

    if (!ctx.dryRun) {
      await ctx.db.nPC.update({
        where: { id: decision.successorId },
        data: { factionRole: 'LEADER' },
      })
    }

    changes.push({
      entityType: 'NPC',
      entityId: decision.successorId,
      entityName: decision.successorName,
      campaignId: ctx.campaignId,
      field: 'factionRole',
      previousValue: decision.previousRole,
      newValue: 'LEADER',
      reason: decision.reason,
      significant: true,
      importance: 'MAJOR',
    })
  }

  return { changes }
}
