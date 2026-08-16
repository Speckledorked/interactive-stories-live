// src/lib/game/tick/seasonTick.ts
// #118: connects the in-fiction calendar (previously display-only — see
// calendarGenerator.ts's now-updated doc comment) to two small,
// deterministic mechanical knobs, decided 2026-08-02 as the closed set —
// nothing else:
//
// 1. Faction resource regen — this handler's own responsibility, applied
//    directly to every active faction's resources once per turn.
// 2. Unattached-GM-clock speed — decideClockAdvancement (clockTick.ts)
//    takes SEASON_MODIFIERS[season].clockSpeedMultiplier as its own
//    parameter, since clock advancement runs outside TICK_HANDLERS
//    entirely (see clockTick.ts's header comment) and this handler has no
//    way to reach it directly.

import { GeneratedCalendar, Season, deriveSeason } from '../calendar'
import { TickContext, TickHandlerResult, WorldChange, clamp } from './types'
import { rosterFactionFilter } from './capOrdering'

export interface SeasonModifier {
  resourceRegenDelta: number
  clockSpeedMultiplier: number
}

// Harvest (autumn) boosts faction income and quickens the world's pace;
// winter slows both. Spring/summer sit at the neutral baseline between the
// two — this is a fixed, closed table, not something a campaign configures.
export const SEASON_MODIFIERS: Record<Season, SeasonModifier> = {
  spring: { resourceRegenDelta: 0, clockSpeedMultiplier: 1 },
  summer: { resourceRegenDelta: 0, clockSpeedMultiplier: 1 },
  autumn: { resourceRegenDelta: 2, clockSpeedMultiplier: 1.15 },
  winter: { resourceRegenDelta: -2, clockSpeedMultiplier: 0.85 },
}

function parseCalendarConfig(raw: unknown): GeneratedCalendar | null {
  return raw ? (raw as unknown as GeneratedCalendar) : null
}

export async function tickSeasonalPressure(ctx: TickContext): Promise<TickHandlerResult> {
  const worldMeta = await ctx.db.worldMeta.findUnique({
    where: { campaignId: ctx.campaignId },
    select: {
      totalElapsedGameHours: true,
      campaign: { select: { calendarConfig: true } },
    },
  })
  if (!worldMeta) return { changes: [] }

  const calendar = parseCalendarConfig(worldMeta.campaign?.calendarConfig)
  const season = deriveSeason(worldMeta.totalElapsedGameHours, calendar)
  const modifier = SEASON_MODIFIERS[season]

  // Spring/summer baseline: nothing to apply, skip the faction query
  // entirely rather than writing a bunch of no-op zero-deltas.
  if (modifier.resourceRegenDelta === 0) return { changes: [] }

  const factions = await ctx.db.faction.findMany({
    where: { campaignId: ctx.campaignId, isActive: true, ...rosterFactionFilter(ctx) },
  })

  const changes: WorldChange[] = []

  for (const faction of factions) {
    const nextResources = clamp(faction.resources + modifier.resourceRegenDelta, 0, 100)
    if (nextResources === faction.resources) continue

    if (!ctx.dryRun) {
      await ctx.db.faction.update({
        where: { id: faction.id },
        data: { resources: nextResources },
      })
    }

    changes.push({
      entityType: 'FACTION',
      entityId: faction.id,
      entityName: faction.name,
      campaignId: ctx.campaignId,
      field: 'resources',
      previousValue: faction.resources,
      newValue: nextResources,
      reason: modifier.resourceRegenDelta > 0
        ? `Harvest season boosts ${faction.name}'s resources`
        : `Winter scarcity strains ${faction.name}'s resources`,
      // Routine seasonal drift, not history/RAG-worthy on its own — same
      // tier as weatherTick's severity-only wobble.
      significant: false,
      importance: 'NORMAL',
    })
  }

  return { changes }
}
