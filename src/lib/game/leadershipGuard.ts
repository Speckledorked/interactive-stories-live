// src/lib/game/leadershipGuard.ts
// #275: the schema documents "at most one leader either way" for a
// Faction (Faction.leaderCharacterId vs. NPC.factionRole LEADER), and the
// Faction PATCH route already enforces its own half of that (assigning a
// PC leader demotes any existing NPC LEADER) — but the NPC create/update
// routes let an admin set factionRole: 'LEADER' directly with no check
// against the OTHER side of the same invariant at all. Shared here so both
// routes (and any future one) enforce identically rather than drifting.
//
// Two asymmetric outcomes, deliberately not both "auto-demote": a PC
// leader is described in the schema's own comment as "the player's own
// strategic choice" that even automatic goal reassessment never overrides
// — silently un-appointing one from an NPC-focused route would be a
// bigger, more surprising side effect than that route's own scope
// suggests, so this rejects instead. An existing NPC LEADER is not a
// deliberate player choice the same way, so it's auto-demoted, mirroring
// the Faction route's own established convention for the mirror-image case.

import { prisma } from '@/lib/prisma'

export type LeadershipGuardResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Call before writing factionRole: 'LEADER' onto an NPC. `excludeNpcId` is
 * the NPC being updated (already the LEADER itself, so it shouldn't be
 * treated as a conflict with its own prior role) — null for a create,
 * where no such NPC exists yet.
 */
export async function guardNpcLeaderAssignment(
  campaignId: string,
  factionId: string,
  excludeNpcId: string | null
): Promise<LeadershipGuardResult> {
  const faction = await prisma.faction.findUnique({
    where: { id: factionId, campaignId },
    select: { leaderCharacterId: true },
  })
  if (faction?.leaderCharacterId) {
    return {
      ok: false,
      error: 'This faction already has a player-character leader. Remove them (via the faction editor) before assigning an NPC leader.',
    }
  }

  await prisma.nPC.updateMany({
    where: {
      campaignId,
      factionId,
      factionRole: 'LEADER',
      isAlive: true,
      ...(excludeNpcId ? { id: { not: excludeNpcId } } : {}),
    },
    data: { factionRole: 'MEMBER' },
  })

  return { ok: true }
}
