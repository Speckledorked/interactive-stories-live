// src/lib/game/tick/weatherTick.ts
// World Sim Phase 1 — persistent weather per Location.
//
// Weather is deterministic: each location's next condition is chosen from a
// fixed transition table using a stable hash of (locationId, turnNumber), not
// Math.random(). Same tick number always produces the same weather for a
// given location, so results are reproducible.

import { prisma } from '@/lib/prisma'
import type { Location, WeatherCondition } from '@prisma/client'
import { TickContext, TickHandlerResult, WorldChange, clamp, stableHash } from './types'

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

export interface WeatherTickDecision {
  nextCondition: WeatherCondition
  nextSeverity: number
}

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideNextWeather(
  locationId: string,
  turnNumber: number,
  currentCondition: WeatherCondition,
  currentSeverity: number
): WeatherTickDecision {
  const options = TRANSITIONS[currentCondition]
  const conditionRoll = stableHash(`${locationId}:${turnNumber}:condition`)
  const nextCondition = options[conditionRoll % options.length]

  const severityRoll = stableHash(`${locationId}:${turnNumber}:severity`) % 3 // 0,1,2 -> -1,0,+1
  const severityDelta = severityRoll - 1
  const nextSeverity = clamp(currentSeverity + severityDelta, 1, 5)

  return { nextCondition, nextSeverity }
}

export async function tickWeather(ctx: TickContext): Promise<TickHandlerResult> {
  const locations = await prisma.location.findMany({
    where: { campaignId: ctx.campaignId },
  })

  const changes: WorldChange[] = []

  for (const location of locations) {
    const decision = decideNextWeather(
      location.id,
      ctx.turnNumber,
      location.weather,
      location.weatherSeverity
    )

    const conditionChanged = decision.nextCondition !== location.weather
    const severityChanged = decision.nextSeverity !== location.weatherSeverity

    if (!conditionChanged && !severityChanged) {
      continue
    }

    if (!ctx.dryRun) {
      await prisma.location.update({
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
