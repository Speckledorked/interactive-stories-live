// src/lib/game/tick/caps.ts
// World Sim Phase 8 — per-tick simulation caps, parameterized per campaign.
//
// Every tick handler that queries factions/NPCs bounds how many it
// considers per turn (`take: N`) so a campaign with a huge roster doesn't
// blow up tick cost. These were hardcoded as a local `const` duplicated
// across factionTick.ts, leadershipTick.ts, warTick.ts, ambitionTick.ts,
// relationshipTick.ts (FACTION_CAP) and npcTick.ts (NPC_CAP). Resolved once
// per tick in worldTick.ts (see resolveTickCaps) and threaded through
// TickContext so every handler sees the same value for a given turn instead
// of each independently reading WorldMeta.

export const DEFAULT_FACTION_CAP = 10
export const DEFAULT_NPC_CAP = 20

// #203: caps are admin-settable per campaign (settings/simulation/route.ts)
// with no upper bound of their own — nothing here previously stopped an
// admin raising them arbitrarily high. That matters because worldTick.ts's
// real (non-dry-run) tick wraps every handler in ONE prisma.$transaction
// with a flat TICK_TRANSACTION_TIMEOUT_MS = 20_000 ceiling that does NOT
// scale with these caps: a campaign whose caps are raised far enough could
// blow that budget, aborting the whole world turn for that cycle (fails
// safe — no partial-state commit — but the turn is lost rather than
// degrading gracefully).
//
// 5x the defaults is the deliberately conservative bound chosen here, not
// a measured ceiling — Phase 3's live-Postgres verification measured a
// full transactional tick pass at DEFAULT_FACTION_CAP/DEFAULT_NPC_CAP
// (10/20) taking roughly 100ms, ~200x of headroom under the 20s timeout.
// Even under a pessimistic linear-scaling assumption, 5x the roster size
// stays nowhere close to that ceiling while keeping caps within the "tens
// of entities" scale this whole tick architecture is designed around (see
// docs/ARCHITECTURE.md) rather than opening the door to genuinely large
// rosters no handler here was ever measured against.
export const MAX_FACTION_CAP = DEFAULT_FACTION_CAP * 5
export const MAX_NPC_CAP = DEFAULT_NPC_CAP * 5

export function resolveTickCaps(worldMeta: { factionCap: number | null; npcCap: number | null } | null): {
  factionCap: number
  npcCap: number
} {
  return {
    factionCap: worldMeta?.factionCap ?? DEFAULT_FACTION_CAP,
    npcCap: worldMeta?.npcCap ?? DEFAULT_NPC_CAP,
  }
}

/**
 * #410: what a tick could not simulate, and when.
 *
 * Every cap in this engine was silent. `factionCap`/`npcCap` do not
 * degrade a simulation gracefully — an entity beyond the cap does not
 * advance that turn at all, so its state goes STALE rather than partial: a
 * war whose participants missed the page does not progress, and nothing
 * anywhere said so. ARCHITECTURE.md conceded it in as many words ("no
 * error, no log, no UI anywhere").
 *
 * The integrity engine already demonstrates the right pattern — it reports
 * unrepaired items and fails safe — so this is that pattern applied to the
 * caps.
 *
 * Persisted to WorldMeta.lastTickCapReport inside the tick transaction, so
 * it describes a tick that actually committed.
 */
export interface TickCapReport {
  /** ISO timestamp of the tick that produced this report. */
  at: string
  simulationTurn: number
  factionCap: number
  npcCap: number
  /** How many entities the tick actually simulated. */
  factionsSimulated: number
  npcsSimulated: number
  /** True when the cap truncated the roster — i.e. something went stale. */
  factionCapHit: boolean
  npcCapHit: boolean
}

/** Whether this report is worth surfacing to an admin at all. */
export function capReportIsNoteworthy(report: TickCapReport | null | undefined): boolean {
  return Boolean(report && (report.factionCapHit || report.npcCapHit))
}
