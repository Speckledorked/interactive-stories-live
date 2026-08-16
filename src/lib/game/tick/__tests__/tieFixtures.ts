// src/lib/game/tick/__tests__/tieFixtures.ts
// #373: test fixtures for the tie edge tables.
//
// Handlers read one entity's ties through `factionTies(f)` / `npcTies(n)`
// (tieGraph.ts), which project the two Prisma relation arrays a
// `include: TIE_INCLUDE` produces. These helpers build those arrays from
// the same `{ otherId: { type, since } }` map the fixtures used to set on
// the old JSON column, so a test still SAYS what it means ("f1 counts f2 a
// rival") rather than spelling out which side of a canonical pair each id
// lands on.
//
// The canonical ordering is applied here rather than hand-written in the
// fixtures on purpose: a fixture that put the endpoints in the wrong order
// would be testing against data Postgres would reject.

export interface TieFixtureEntry {
  type: 'RIVAL' | 'ALLY'
  since?: number
}

export interface FactionTieFixtureRow {
  factionAId: string
  factionBId: string
  type: 'RIVAL' | 'ALLY'
  since: number
}

export interface NpcTieFixtureRow {
  npcAId: string
  npcBId: string
  type: 'RIVAL' | 'ALLY'
  since: number
}

/** The `tiesAsA`/`tiesAsB` pair for one faction, from a map of who it knows. */
export function factionTieRows(
  selfId: string,
  ties: Record<string, TieFixtureEntry> = {}
): { tiesAsA: FactionTieFixtureRow[]; tiesAsB: FactionTieFixtureRow[] } {
  const tiesAsA: FactionTieFixtureRow[] = []
  const tiesAsB: FactionTieFixtureRow[] = []
  for (const [otherId, entry] of Object.entries(ties)) {
    const since = entry.since ?? 0
    if (selfId < otherId) tiesAsA.push({ factionAId: selfId, factionBId: otherId, type: entry.type, since })
    else tiesAsB.push({ factionAId: otherId, factionBId: selfId, type: entry.type, since })
  }
  return { tiesAsA, tiesAsB }
}

/** NPC counterpart of factionTieRows. */
export function npcTieRows(
  selfId: string,
  ties: Record<string, TieFixtureEntry> = {}
): { tiesAsA: NpcTieFixtureRow[]; tiesAsB: NpcTieFixtureRow[] } {
  const tiesAsA: NpcTieFixtureRow[] = []
  const tiesAsB: NpcTieFixtureRow[] = []
  for (const [otherId, entry] of Object.entries(ties)) {
    const since = entry.since ?? 0
    if (selfId < otherId) tiesAsA.push({ npcAId: selfId, npcBId: otherId, type: entry.type, since })
    else tiesAsB.push({ npcAId: otherId, npcBId: selfId, type: entry.type, since })
  }
  return { tiesAsA, tiesAsB }
}

/**
 * Standalone edge rows for the whole-campaign queries (relationshipTick,
 * npcSocietyTick, informationTick) — those read the tie table directly
 * rather than through an entity's relations.
 */
export function factionTieTable(pairs: Array<[string, string, 'RIVAL' | 'ALLY', number?]>): FactionTieFixtureRow[] {
  return pairs.map(([x, y, type, since = 0]) =>
    x < y
      ? { factionAId: x, factionBId: y, type, since }
      : { factionAId: y, factionBId: x, type, since }
  )
}

export function npcTieTable(pairs: Array<[string, string, 'RIVAL' | 'ALLY', number?]>): NpcTieFixtureRow[] {
  return pairs.map(([x, y, type, since = 0]) =>
    x < y ? { npcAId: x, npcBId: y, type, since } : { npcAId: y, npcBId: x, type, since }
  )
}
