// src/lib/api/worldEventFog.ts
//
// Fog of war for WorldEvent rows (#520/#522/#523).
//
// WorldEvent.targetId is a plain string with no foreign key — deliberately,
// since target rows can be deleted independently — and targetType spans
// eleven entity kinds. So "may this player see this event" cannot be a
// where-clause on the events table the way visibleTo() handles a query
// against factions or npcs directly. It has to be resolved against the
// visible ids of each gated model and then applied per row.
//
// Built once per request and reused, because all three player-facing
// readers of this table need the identical filter and the alternative is
// three hand-rolled versions of it — the duplicated-rule pattern
// visibility.ts exists to end, at the one layer where drift is a data
// leak rather than a wrong number.

import { prisma } from '@/lib/prisma'
import { visibleTo, isCampaignAdmin, type CampaignRole } from './visibility'

/** The shape this filter needs off a WorldEvent row. */
export interface FogGatedEvent {
  targetType: string
  targetId: string
}

/**
 * Which fog-gated model each WorldEventTargetType resolves to.
 *
 * The three LOCATION_* types are all events ABOUT a Location — weather
 * over it, its condition, its population — so they gate on that
 * location's own discovery.
 *
 * An absent targetType is DENIED, not allowed. Four of the enum's values
 * (QUEST, WAR, CHARACTER, DEBT) have no fog column anywhere in this
 * codebase and would be safe to pass through today; they are left out
 * anyway so that adding a phrasing for one in worldEventPhrasing.ts
 * forces a deliberate decision here rather than quietly inheriting
 * "visible to everyone". Nothing is currently lost by that: the phrasing
 * table has no sentence for any of them, so they never reach a player
 * surface in the first place.
 */
const TARGET_FOG_MODEL = {
  FACTION: 'faction',
  NPC: 'npc',
  LOCATION: 'location',
  LOCATION_WEATHER: 'location',
  LOCATION_CONDITION: 'location',
  LOCATION_POPULATION: 'location',
  CLOCK: 'clock',
} as const

type GatedTargetType = keyof typeof TARGET_FOG_MODEL

/**
 * A predicate deciding whether one event's target is visible to this role.
 *
 * Returns an always-true predicate for an admin — they see through the
 * fog everywhere else, and the four id queries below would be wasted work.
 */
export async function buildWorldEventFog(
  campaignId: string,
  role: CampaignRole
): Promise<(event: FogGatedEvent) => boolean> {
  if (isCampaignAdmin(role)) return () => true

  // Id-only selects: this is a membership test, and pulling whole rows to
  // answer it would be the expensive way to ask.
  const [factions, npcs, locations, clocks] = await Promise.all([
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
    prisma.clock.findMany({
      where: { campaignId, ...visibleTo('clock', role) },
      select: { id: true },
    }),
  ])

  const visibleIds: Record<(typeof TARGET_FOG_MODEL)[GatedTargetType], Set<string>> = {
    faction: new Set(factions.map((r) => r.id)),
    npc: new Set(npcs.map((r) => r.id)),
    location: new Set(locations.map((r) => r.id)),
    clock: new Set(clocks.map((r) => r.id)),
  }

  return (event: FogGatedEvent) => {
    const model = TARGET_FOG_MODEL[event.targetType as GatedTargetType]
    if (!model) return false
    return visibleIds[model].has(event.targetId)
  }
}
