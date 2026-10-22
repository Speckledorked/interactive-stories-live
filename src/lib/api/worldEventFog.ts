// src/lib/api/worldEventFog.ts
//
// Fog of war for WorldEvent rows (#520).
//
// WorldEvent.targetId is a plain string with no foreign key — deliberately,
// since target rows can be deleted independently — and targetType spans
// eleven entity kinds. So "may this player see this event" cannot be a
// where-clause on the events table the way visibleTo() handles a query
// against factions or npcs directly. It has to be resolved against the
// visible ids of each gated model and then applied per row.
//
// WHICH TYPES ARE GATED IS NOT DECIDED HERE. It comes from
// world-digest.ts's DISCOVERY_SOURCE_BY_ENTITY_TYPE, which is the table
// the world digest and the absence journal (#395/#432/#396) already share.
// That table's own comment explains why: the gate and the id set used to
// be two independent lists, #432 changed one and not the other, and every
// location change then failed a check against a set that could never
// contain it — "that inverted the leak into a total blackout".
//
// This module shipped with a hand-written third copy of that mapping, with
// a different answer: it gated CLOCK, and it denied every type the table
// does not list (QUEST, WAR, CHARACTER, DEBT). Both were wrong in the same
// direction — silently dropping events the other two surfaces show — and
// both were exactly the defect the shared table exists to prevent. The
// mapping is now read, not restated.
//
// One known divergence remains, and it is the shared table's rather than
// this file's: CLOCK is absent from it, so a hidden clock's tick reaches
// every player-facing reader of WorldEvent. Clocks do model concealment
// (Clock.isHidden, inverted polarity — see visibility.ts). That is a
// pre-existing leak in three surfaces, not something to fork a fourth
// answer over, so it is raised separately rather than fixed here.

import { prisma } from '@/lib/prisma'
import { DISCOVERY_SOURCE_BY_ENTITY_TYPE } from '@/lib/notifications/world-digest'
import { visibleTo, isCampaignAdmin, type CampaignRole } from './visibility'

/** The shape this filter needs off a WorldEvent row. */
export interface FogGatedEvent {
  targetType: string
  targetId: string
}

type DiscoverySource = (typeof DISCOVERY_SOURCE_BY_ENTITY_TYPE)[keyof typeof DISCOVERY_SOURCE_BY_ENTITY_TYPE]

/** Which fog-gated model each discovery source resolves through. The
 *  Prisma accessor and the visibleTo() model name differ only for NPC. */
const FOG_MODEL: Record<DiscoverySource, 'npc' | 'faction' | 'location'> = {
  nPC: 'npc',
  faction: 'faction',
  location: 'location',
}

/**
 * A predicate deciding whether one event's target is visible to this role.
 *
 * Returns an always-true predicate for an admin — they see through the fog
 * everywhere else, and the id queries below would be wasted work.
 *
 * A targetType the shared table does not list passes through, because
 * those types do not model discovery: a quest, a war or a debt is not
 * something the party "learns exists".
 */
export async function buildWorldEventFog(
  campaignId: string,
  role: CampaignRole
): Promise<(event: FogGatedEvent) => boolean> {
  if (isCampaignAdmin(role)) return () => true

  // Id-only selects: this is a membership test, and pulling whole rows to
  // answer it would be the expensive way to ask.
  const [factions, npcs, locations] = await Promise.all([
    prisma.faction.findMany({
      where: { campaignId, ...visibleTo('faction', role) },
      select: { id: true },
    }),
    prisma.nPC.findMany({
      where: { campaignId, ...visibleTo('npc', role) },
      select: { id: true },
    }),
    prisma.location.findMany({
      where: { campaignId, ...visibleTo('location', role) },
      select: { id: true },
    }),
  ])

  const visibleIds: Record<'npc' | 'faction' | 'location', Set<string>> = {
    faction: new Set(factions.map((r) => r.id)),
    npc: new Set(npcs.map((r) => r.id)),
    location: new Set(locations.map((r) => r.id)),
  }

  return (event: FogGatedEvent) => {
    const source = (DISCOVERY_SOURCE_BY_ENTITY_TYPE as Record<string, DiscoverySource | undefined>)[
      event.targetType
    ]
    if (!source) return true
    return visibleIds[FOG_MODEL[source]].has(event.targetId)
  }
}
