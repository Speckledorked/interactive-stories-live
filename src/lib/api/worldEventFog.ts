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
// #524 fixed the one divergence that was left: CLOCK was absent from the
// shared table, so a hidden clock's tick reached every player-facing
// reader of WorldEvent. It is gated there now, which is why the ids below
// are built by iterating that table rather than naming three models.

import { prisma } from '@/lib/prisma'
import {
  DISCOVERY_SOURCE_BY_ENTITY_TYPE,
  DISCOVERY_SOURCE_MODELS,
} from '@/lib/notifications/world-digest'
import {
  visibleTo,
  isCampaignAdmin,
  FOG_PRISMA_MODEL,
  type CampaignRole,
  type FogGatedModel,
} from './visibility'

/** The shape this filter needs off a WorldEvent row. */
export interface FogGatedEvent {
  targetType: string
  targetId: string
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
  // answer it would be the expensive way to ask. Driven off the shared
  // table's own model list, so a type added to the gate brings its ids
  // with it instead of silently failing a lookup in an absent set.
  const idSets = await Promise.all(
    DISCOVERY_SOURCE_MODELS.map((model) =>
      (
        prisma[FOG_PRISMA_MODEL[model]] as {
          findMany: (args: unknown) => Promise<Array<{ id: string }>>
        }
      ).findMany({
        where: { campaignId, ...visibleTo(model, role) },
        select: { id: true },
      })
    )
  )

  const visibleIds = new Map<FogGatedModel, Set<string>>(
    DISCOVERY_SOURCE_MODELS.map((model, i) => [model, new Set(idSets[i].map((r) => r.id))])
  )

  return (event: FogGatedEvent) => {
    const model = (DISCOVERY_SOURCE_BY_ENTITY_TYPE as Record<string, FogGatedModel | undefined>)[
      event.targetType
    ]
    if (!model) return true
    return visibleIds.get(model)?.has(event.targetId) ?? false
  }
}
