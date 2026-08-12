// src/lib/game/tick/territoryLoyaltyTick.ts
// World Sim #119 — territory loyalty as a signed contested-value Arc, the
// second real consumer proving decideArcDelta/decideArcResolution
// (game/arc.ts) are genuinely reusable, not a one-off extraction for wars.
//
// Location.isContested was previously a pure flag — set by a successful
// EXPAND/DESTABILIZE_RIVAL ambition or cleared by a war resolving, but
// nothing independently resolved a contest that never escalated into a
// declared war. A location could sit "contested" indefinitely. This gives
// it its own resolution: an Arc pushes each tick toward whichever of the
// owner or its on-record rival is currently stronger, and a decisive
// swing either cements the owner's hold (contest clears) or flips the
// location to the rival outright — independent of whether a war was ever
// declared over it.
//
// "The rival" is resolved the same way tickFactions/tickWake already do
// (findRivalId on the owner's own relationships) — there is no dedicated
// "who is contesting this location" column, so this reuses the existing
// rival-relationship convention rather than inventing a new field.

import { TickContext, TickHandlerResult, WorldChange, findRivalId } from './types'
import { decideArcDelta, applyArcDelta, decideArcResolution, ArcResolution } from '../arc'

// Same magnitude as WAR_DECISIVE_MOMENTUM (warTick.ts) — a contest this
// one-sided is just as much a foregone conclusion as a decisive war.
const LOYALTY_DECISIVE_THRESHOLD = 60
// Shorter than WAR_MAX_DURATION (10) — an undeclared contest that drags on
// this long settles quietly back to the owner rather than staying in limbo.
const LOYALTY_MAX_DURATION = 8

export interface TerritoryLoyaltyPushResult {
  newValue: number
  resolution: ArcResolution
}

/**
 * Pure — no DB access. One tick's loyalty push for a single contested
 * location: side A is the current owner, side B is the on-record rival
 * contesting it.
 */
export function decideTerritoryLoyaltyPush(
  arcId: string,
  turnNumber: number,
  currentValue: number,
  turnsContested: number,
  owner: { military: number },
  rival: { military: number }
): TerritoryLoyaltyPushResult {
  const delta = decideArcDelta(arcId, turnNumber, { sideAStrength: owner.military, sideBStrength: rival.military })
  const newValue = applyArcDelta(currentValue, delta)
  const resolution = decideArcResolution(newValue, turnsContested, LOYALTY_DECISIVE_THRESHOLD, LOYALTY_MAX_DURATION)
  return { newValue, resolution }
}

export async function tickTerritoryLoyalty(ctx: TickContext): Promise<TickHandlerResult> {
  const allContestedLocations = await ctx.db.location.findMany({
    where: { campaignId: ctx.campaignId, isContested: true, ownerFactionId: { not: null } },
    select: { id: true, name: true, ownerFactionId: true, loyaltyArc: { select: { id: true, value: true, startedTurn: true } } },
  })
  if (allContestedLocations.length === 0) return { changes: [] }

  // #228: a location that's the live contestedLocationId of a still-
  // ESCALATING war stays isContested: true for the war's whole duration —
  // wars own resolution for a location they're actively contesting, so
  // this loyalty Arc must not also resolve (and potentially flip) its
  // ownership out from under the still-open war. Checked fresh each tick,
  // after tickWars has already run this turn (see TICK_HANDLERS ordering
  // in worldTick.ts), so a war that resolved this same turn correctly
  // frees its location up for loyalty resolution the same pass rather than
  // lagging a full extra turn — same pattern tickLocationCondition (#109)
  // already uses for the identical "is this location at war" question.
  const warsContestingLocations = await ctx.db.war.findMany({
    where: { campaignId: ctx.campaignId, status: 'ESCALATING', contestedLocationId: { not: null } },
    select: { contestedLocationId: true },
  })
  const locationIdsAtWar = new Set(warsContestingLocations.map((w) => w.contestedLocationId))
  const contestedLocations = allContestedLocations.filter((l) => !locationIdsAtWar.has(l.id))
  if (contestedLocations.length === 0) return { changes: [] }

  const ownerIds = [...new Set(contestedLocations.map((l) => l.ownerFactionId!))]
  const owners = await ctx.db.faction.findMany({
    where: { id: { in: ownerIds }, isActive: true },
    select: { id: true, name: true, military: true, relationships: true },
  })
  const ownerById = new Map(owners.map((o) => [o.id, o]))

  const changes: WorldChange[] = []

  for (const location of contestedLocations) {
    const owner = ownerById.get(location.ownerFactionId!)
    if (!owner) continue

    const rivalId = findRivalId(owner.relationships)
    if (!rivalId) continue
    const rival = await ctx.db.faction.findUnique({
      where: { id: rivalId },
      select: { id: true, name: true, military: true, isActive: true },
    })
    if (!rival || !rival.isActive) continue

    let arc = location.loyaltyArc
    const currentValue = arc?.value ?? 0
    const startedTurn = arc?.startedTurn ?? ctx.turnNumber
    const turnsContested = ctx.turnNumber - startedTurn

    const push = decideTerritoryLoyaltyPush(location.id, ctx.turnNumber, currentValue, turnsContested, owner, rival)

    if (!ctx.dryRun) {
      if (arc) {
        await ctx.db.arc.update({ where: { id: arc.id }, data: { value: push.newValue } })
      } else {
        try {
          arc = await ctx.db.arc.create({
            data: {
              campaignId: ctx.campaignId,
              kind: 'TERRITORY_LOYALTY',
              value: push.newValue,
              startedTurn: ctx.turnNumber,
              locationId: location.id,
            },
          })
        } catch {
          // A concurrent pass already created this location's arc this
          // turn — skip the push rather than double-apply; next tick
          // picks up cleanly from whatever value that pass wrote.
          continue
        }
      }
    }

    if (!push.resolution.resolves) continue // routine, undecided push — not narratively interesting on its own

    if (!ctx.dryRun && arc) {
      await Promise.all([
        ctx.db.arc.update({ where: { id: arc.id }, data: { value: 0 } }),
        push.resolution.winner === 'B'
          ? ctx.db.location.update({ where: { id: location.id }, data: { ownerFactionId: rival.id, isContested: false } })
          : ctx.db.location.update({ where: { id: location.id }, data: { isContested: false } }),
      ])
    }

    if (push.resolution.winner === 'B') {
      changes.push({
        entityType: 'FACTION',
        entityId: rival.id,
        entityName: rival.name,
        campaignId: ctx.campaignId,
        field: 'territoryClaimed',
        previousValue: owner.name,
        newValue: location.name,
        reason: `${rival.name} wins the loyalty of ${location.name}'s people, seizing it from ${owner.name}`,
        significant: true,
        importance: 'MAJOR',
      })
    } else if (push.resolution.winner === 'A') {
      changes.push({
        entityType: 'FACTION',
        entityId: owner.id,
        entityName: owner.name,
        campaignId: ctx.campaignId,
        field: 'territoryContested',
        previousValue: 'contested',
        newValue: 'secured',
        reason: `${owner.name}'s hold on ${location.name} is cemented; ${rival.name}'s contest fades`,
        significant: true,
        importance: 'NORMAL',
      })
    } else {
      changes.push({
        entityType: 'FACTION',
        entityId: owner.id,
        entityName: owner.name,
        campaignId: ctx.campaignId,
        field: 'territoryContested',
        previousValue: 'contested',
        newValue: 'settled',
        reason: `The contest over ${location.name} quietly settles, unresolved`,
        significant: false,
        importance: 'NORMAL',
      })
    }
  }

  return { changes }
}
