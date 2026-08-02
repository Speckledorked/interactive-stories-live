// src/lib/game/tick/locationConditionTick.ts
// #109: Environmental State & Location Aging — a city sieged twice used to
// look identical, in the data model, to one that's been at peace for 20
// years. Location.conditionScore (0-100, DB-checked, see the migration)
// tracks that; this handler is what drifts it.

import { TickContext, TickHandlerResult, WorldChange, clamp } from './types'

const WAR_DAMAGE = 8
const CONTEST_STRAIN = 2
const PEACETIME_RECOVERY = 1
// STABLE midpoint (see deriveConditionTags below) — peacetime recovery
// pulls a damaged/ruined place back toward this, never past it. An
// already-thriving location has nothing to recover FROM and just holds;
// nothing here decays a prosperous place for no reason.
const BASELINE_CONDITION = 60

export interface ConditionDriftDecision {
  nextConditionScore: number
}

/**
 * Pure decision function — no DB access, safe to unit test directly. Same
 * shape as decideWarProgress: a small deterministic delta, clamped at the
 * write site to the DB-enforced 0-100 range.
 *
 * seasonModifier is accepted but NOT wired up by tickLocationCondition
 * below — #118's seasonal-pressure decision was deliberately scoped to
 * exactly two knobs (faction resource regen, clock speed), and folding a
 * third in here without a matching decision would silently expand that
 * closed scope. The parameter exists so a future, explicitly-decided
 * integration doesn't need to change this function's signature again.
 */
export function decideConditionDrift(
  location: { conditionScore: number },
  warPresent: boolean,
  isContested: boolean,
  seasonModifier: number = 0
): ConditionDriftDecision {
  let delta: number
  if (warPresent) {
    delta = -WAR_DAMAGE
  } else if (isContested) {
    delta = -CONTEST_STRAIN
  } else if (location.conditionScore < BASELINE_CONDITION) {
    delta = PEACETIME_RECOVERY
  } else {
    delta = 0
  }

  delta += seasonModifier

  return { nextConditionScore: clamp(location.conditionScore + delta, 0, 100) }
}

export type ConditionTag = 'ABANDONED' | 'RUINED' | 'DAMAGED' | 'STABLE' | 'PROSPEROUS' | 'CONTESTED'

/**
 * The six-tag closed vocabulary decided for #109 — deliberately NOT a
 * stored column (see the migration/schema comment): derived here from
 * conditionScore + isContested so a tag can never desync from the score
 * that defines it. CONTESTED is an overlay that can accompany any band,
 * mirrored directly from Location.isContested — the one signal the engine
 * already treats as authoritative for "is this place being fought over" —
 * rather than an independently-settable tag.
 */
export function deriveConditionTags(conditionScore: number, isContested: boolean): ConditionTag[] {
  const band: ConditionTag =
    conditionScore <= 0 ? 'ABANDONED'
      : conditionScore < 25 ? 'RUINED'
      : conditionScore < 50 ? 'DAMAGED'
      : conditionScore < 75 ? 'STABLE'
      : 'PROSPEROUS'

  return isContested ? [band, 'CONTESTED'] : [band]
}

export async function tickLocationCondition(ctx: TickContext): Promise<TickHandlerResult> {
  const locations = await ctx.db.location.findMany({
    where: { campaignId: ctx.campaignId },
    select: { id: true, name: true, conditionScore: true, isContested: true },
  })
  if (locations.length === 0) return { changes: [] }

  // A location is "at war" when it's the contested prize of a currently
  // ESCALATING war — checked fresh each tick, after tickWars has already
  // run this turn (see TICK_HANDLERS ordering in worldTick.ts), so a war
  // that resolved this same turn no longer counts.
  const warsContestingLocations = await ctx.db.war.findMany({
    where: { campaignId: ctx.campaignId, status: 'ESCALATING', contestedLocationId: { not: null } },
    select: { contestedLocationId: true },
  })
  const locationIdsAtWar = new Set(warsContestingLocations.map((w) => w.contestedLocationId))

  const changes: WorldChange[] = []

  for (const location of locations) {
    const warPresent = locationIdsAtWar.has(location.id)
    const decision = decideConditionDrift(location, warPresent, location.isContested)
    if (decision.nextConditionScore === location.conditionScore) continue

    if (!ctx.dryRun) {
      await ctx.db.location.update({
        where: { id: location.id },
        data: { conditionScore: decision.nextConditionScore },
      })
    }

    changes.push({
      entityType: 'LOCATION_CONDITION',
      entityId: location.id,
      entityName: location.name,
      campaignId: ctx.campaignId,
      field: 'conditionScore',
      previousValue: location.conditionScore,
      newValue: decision.nextConditionScore,
      reason: warPresent
        ? `Ongoing war ravages ${location.name}`
        : location.isContested
          ? `Contested rule strains ${location.name}`
          : `${location.name} slowly recovers`,
      // Only a war-driven shift is significant enough for campaign
      // history/RAG — peacetime recovery and mere-contest strain are
      // routine drift, same tier as weatherTick's severity-only wobble.
      significant: warPresent,
      importance: warPresent ? 'MAJOR' : 'NORMAL',
    })
  }

  return { changes }
}
