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

import { prisma } from '@/lib/prisma'
import { TickContext, TickHandlerResult, WorldChange } from './types'

const FACTION_CAP = 10

export async function tickFactionLeadership(ctx: TickContext): Promise<TickHandlerResult> {
  const factions = await prisma.faction.findMany({
    where: { campaignId: ctx.campaignId, isActive: true },
    orderBy: { createdAt: 'asc' },
    take: FACTION_CAP,
    include: {
      members: {
        where: { isAlive: true },
        orderBy: { importance: 'desc' },
      },
    },
  })

  const changes: WorldChange[] = []

  for (const faction of factions) {
    if (faction.members.length === 0) continue

    const hasLivingLeader = faction.members.some((m) => m.factionRole === 'LEADER')
    if (hasLivingLeader) continue

    // Members are already sorted by importance descending.
    const successor = faction.members[0]
    await prisma.nPC.update({
      where: { id: successor.id },
      data: { factionRole: 'LEADER' },
    })

    changes.push({
      entityType: 'NPC',
      entityId: successor.id,
      entityName: successor.name,
      campaignId: ctx.campaignId,
      field: 'factionRole',
      previousValue: 'MEMBER',
      newValue: 'LEADER',
      reason: `${successor.name} steps up to lead ${faction.name}`,
      significant: true,
      importance: 'MAJOR',
    })
  }

  return { changes }
}
