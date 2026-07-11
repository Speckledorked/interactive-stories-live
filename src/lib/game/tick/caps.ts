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

export function resolveTickCaps(worldMeta: { factionCap: number | null; npcCap: number | null } | null): {
  factionCap: number
  npcCap: number
} {
  return {
    factionCap: worldMeta?.factionCap ?? DEFAULT_FACTION_CAP,
    npcCap: worldMeta?.npcCap ?? DEFAULT_NPC_CAP,
  }
}
