// src/lib/game/tick/capOrdering.ts
// #283: shared rotation ordering/bump helpers for the per-tick entity cap.
//
// Every tick handler that reads a capped slice of a campaign's factions or
// major NPCs used to order that slice by a static key (createdAt asc for
// factions; importance desc for the NPC handlers) with take: cap. A static
// key means the SAME cutoff wins every single tick forever — the newest
// entities (including splinter/succession factions the simulation itself
// spawns via absorption/collapse) never get simulated once a campaign's
// roster exceeds its cap, permanently and silently.
//
// Fixed with Faction.lastTickedAt/NPC.lastTickedAt (nullable — null means
// "never ticked," which sorts first: maximally overdue). TICK_ROTATION_ORDER
// is appended to each handler's orderBy as the ROTATION key rather than
// replacing an existing intentional priority key: the NPC handlers keep
// preferring more important NPCs first (importance desc), but ties among
// equally-important NPCs now rotate instead of the same subset winning
// forever. Faction handlers, which had no such priority key, use this as
// their sole ordering. Every handler bumps lastTickedAt to now for whatever
// it actually selected, immediately after the capped query returns —
// markFactionsTicked/markNpcsTicked below.

export const TICK_ROTATION_ORDER = { lastTickedAt: { sort: 'asc' as const, nulls: 'first' as const } }

interface FactionTickDb {
  faction: { updateMany: (args: { where: { id: { in: string[] } }; data: { lastTickedAt: Date } }) => Promise<{ count: number }> }
}

interface NpcTickDb {
  nPC: { updateMany: (args: { where: { id: { in: string[] } }; data: { lastTickedAt: Date } }) => Promise<{ count: number }> }
}

export async function markFactionsTicked(db: FactionTickDb, factionIds: string[]): Promise<void> {
  if (factionIds.length === 0) return
  await db.faction.updateMany({ where: { id: { in: factionIds } }, data: { lastTickedAt: new Date() } })
}

export async function markNpcsTicked(db: NpcTickDb, npcIds: string[]): Promise<void> {
  if (npcIds.length === 0) return
  await db.nPC.updateMany({ where: { id: { in: npcIds } }, data: { lastTickedAt: new Date() } })
}
