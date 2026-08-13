// src/lib/game/tick/weatherTick.ts
// World Sim Phase 1 — persistent weather per Location.
//
// Weather is deterministic: each location's next condition is chosen from a
// fixed transition table using a stable hash of (locationId, turnNumber), not
// Math.random(). Same tick number always produces the same weather for a
// given location, so results are reproducible.

import type { Location, WeatherCondition } from '@prisma/client'
import { TickContext, TickHandlerResult, WorldChange, clamp, stableHash } from './types'
import type { Season } from '../calendar'

// Weather tends to persist or drift to a neighboring condition rather than
// jumping wildly (e.g. CLEAR never jumps straight to SNOW).
const TRANSITIONS: Record<WeatherCondition, WeatherCondition[]> = {
  CLEAR: ['CLEAR', 'CLEAR', 'CLOUDY'],
  CLOUDY: ['CLOUDY', 'CLEAR', 'RAIN', 'FOG'],
  RAIN: ['RAIN', 'CLOUDY', 'STORM'],
  STORM: ['STORM', 'RAIN', 'CLOUDY'],
  SNOW: ['SNOW', 'CLOUDY', 'CLEAR'],
  FOG: ['FOG', 'CLOUDY', 'CLEAR'],
}

const SEVERE_CONDITIONS: WeatherCondition[] = ['STORM', 'SNOW']

// #263: seasonal pressure's third mechanical knob (the first two,
// faction resource regen and unattached-clock speed, live in
// seasonTick.ts). A fixed, closed table, same shape as SEASON_MODIFIERS —
// deliberately a WEIGHT bias on conditions TRANSITIONS already allows from
// the current condition, never a new condition it doesn't: winter/summer
// don't get to make CLEAR jump straight to SNOW, they just make an
// already-reachable SNOW/CLEAR more likely to be the roll that lands.
// Conditions absent from a season's list (e.g. spring has none) are
// unbiased — plain TRANSITIONS odds, exactly the pre-#263 behavior.
const SEASON_FAVORED_CONDITIONS: Record<Season, WeatherCondition[]> = {
  spring: [],
  summer: ['CLEAR'],
  autumn: ['CLOUDY', 'RAIN'],
  winter: ['SNOW', 'STORM'],
}
// How many extra copies of a favored-and-already-reachable condition to
// append to the weighted pick — small enough that an unfavored condition
// already in TRANSITIONS can still come up, not a guarantee.
const SEASON_BIAS_WEIGHT = 2

/**
 * Pure. `base` is TRANSITIONS[currentCondition] — this only ever appends
 * extra copies of a condition already present in `base`, so a season bias
 * can shift the odds among a location's already-legal next conditions but
 * can never introduce a condition the plain (season-blind) transition
 * table wouldn't have allowed from here.
 */
export function seasonBiasedOptions(base: WeatherCondition[], season: Season | undefined): WeatherCondition[] {
  if (!season) return base
  const favored = SEASON_FAVORED_CONDITIONS[season]
  if (favored.length === 0) return base
  const extra: WeatherCondition[] = []
  for (const condition of favored) {
    if (base.includes(condition)) {
      for (let i = 0; i < SEASON_BIAS_WEIGHT; i++) extra.push(condition)
    }
  }
  return extra.length > 0 ? [...base, ...extra] : base
}

export interface WeatherTickDecision {
  nextCondition: WeatherCondition
  nextSeverity: number
}

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideNextWeather(
  locationId: string,
  turnNumber: number,
  currentCondition: WeatherCondition,
  currentSeverity: number,
  season?: Season
): WeatherTickDecision {
  const options = seasonBiasedOptions(TRANSITIONS[currentCondition], season)
  const conditionRoll = stableHash(`${locationId}:${turnNumber}:condition`)
  const nextCondition = options[conditionRoll % options.length]

  const severityRoll = stableHash(`${locationId}:${turnNumber}:severity`) % 3 // 0,1,2 -> -1,0,+1
  const severityDelta = severityRoll - 1
  const nextSeverity = clamp(currentSeverity + severityDelta, 1, 5)

  return { nextCondition, nextSeverity }
}

export async function tickWeather(ctx: TickContext): Promise<TickHandlerResult> {
  const locations = await ctx.db.location.findMany({
    where: { campaignId: ctx.campaignId },
  })

  const changes: WorldChange[] = []

  for (const location of locations) {
    const decision = decideNextWeather(
      location.id,
      ctx.turnNumber,
      location.weather,
      location.weatherSeverity,
      ctx.season
    )

    const conditionChanged = decision.nextCondition !== location.weather
    const severityChanged = decision.nextSeverity !== location.weatherSeverity

    if (!conditionChanged && !severityChanged) {
      continue
    }

    if (!ctx.dryRun) {
      await ctx.db.location.update({
        where: { id: location.id },
        data: {
          weather: decision.nextCondition,
          weatherSeverity: decision.nextSeverity,
          weatherUpdatedAt: new Date(),
        },
      })
    }

    // Only a condition change (not a severity wobble within the same
    // condition) is worth a history entry — otherwise every location would
    // log noise every single tick.
    if (conditionChanged) {
      changes.push(
        buildWeatherChange(ctx.campaignId, location, decision, location.weather)
      )
    }
  }

  return { changes }
}

function buildWeatherChange(
  campaignId: string,
  location: Location,
  decision: WeatherTickDecision,
  previousCondition: WeatherCondition
): WorldChange {
  return {
    entityType: 'LOCATION_WEATHER',
    entityId: location.id,
    entityName: location.name,
    campaignId,
    field: 'weather',
    previousValue: previousCondition,
    newValue: decision.nextCondition,
    reason: `Weather shifted from ${previousCondition} to ${decision.nextCondition} (severity ${decision.nextSeverity}/5)`,
    significant: true,
    importance: SEVERE_CONDITIONS.includes(decision.nextCondition) ? 'MAJOR' : 'NORMAL',
  }
}
