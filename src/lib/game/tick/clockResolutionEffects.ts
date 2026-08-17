// src/lib/game/tick/clockResolutionEffects.ts
// Mechanical follow-through for a GENERIC (non-ambition, no sourceFactionId)
// clock's completion — the counterpart to ambitionResolution.ts, which
// already does this for faction ambition clocks. Without this, a GM/world
// clock like "the outworlder's arrival is producing hazardous astral
// effects" only ever produced a narrated TimelineEvent (see
// checkAndResolveCompletedClocks in stateUpdater.ts) with nothing behind
// it — the fiction said something kept happening, but nothing in the
// simulation did.
//
// The AI (clockResolutionEffects.ts in lib/ai/) only ever picks from a
// closed catalogue of effect types and supplies bounded parameters — it
// never invents a location/faction name or an unbounded delta. This file
// is what actually resolves those names against real rows and clamps
// those deltas before anything is written, the same "closed catalogue,
// AI only picks the verdict" discipline used throughout this engine
// (worldRules.ts, the Integrity Engine's repairs, ambitionResolution.ts
// itself).

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveEntityByNameOrId, ResolvableEntity } from '../entityResolution'
import { WorldChange, clamp } from './types'
import { persistWorldEvents } from './worldEventLog'
import { logSignificantChanges } from './historyLog'
import { syncWikiEntriesForChanges } from './wikiSync'
import { generateClockResolutionEffects } from '@/lib/ai/clockResolutionEffects'
import type { SimTurn } from '@/lib/game/turnClock'
import {
  ClockResolutionEffect,
  MAX_EFFECTS_PER_CLOCK,
  SPAWN_CLOCK_MIN_TICKS,
  SPAWN_CLOCK_MAX_TICKS,
  MAX_FACTION_STAT_DELTA,
  MAX_THREAT_LEVEL_DELTA,
  MAX_LOCATION_CONDITION_DELTA,
} from './clockResolutionTypes'

// Re-exported so existing importers of this file (tests, worldTurn.ts) can
// pull everything from one place without also knowing about the standalone
// types file underneath it.
export type { ClockResolutionEffect, ClockResolutionEffectType } from './clockResolutionTypes'
export {
  MAX_EFFECTS_PER_CLOCK,
  SPAWN_CLOCK_MIN_TICKS,
  SPAWN_CLOCK_MAX_TICKS,
  MAX_FACTION_STAT_DELTA,
  MAX_THREAT_LEVEL_DELTA,
  MAX_LOCATION_CONDITION_DELTA,
} from './clockResolutionTypes'

interface SourceClock {
  id: string
  name: string
  campaignId: string
  agendaId: string | null
}

interface FactionRow extends ResolvableEntity {
  resources: number
  stability: number
  military: number
  threatLevel: number
}

type Db = Prisma.TransactionClient

/**
 * Apply a batch of already-generated effects for one completed clock.
 * Every entity reference is resolved against REAL rows (never trusts the
 * AI's spelling) — an effect naming an unresolvable or ambiguous target is
 * skipped, not guessed. Returns the WorldChange entries for whatever
 * actually got written, so the caller can run them through the normal
 * event/history/wiki pipeline exactly like every other tick change.
 */
export async function applyClockResolutionEffects(
  db: Db,
  // #437: the SIMULATION turn — one phase of a world turn.
  currentTurn: SimTurn,
  sourceClock: SourceClock,
  effects: ClockResolutionEffect[],
  locations: ResolvableEntity[],
  factions: FactionRow[]
): Promise<WorldChange[]> {
  const changes: WorldChange[] = []

  for (const effect of effects.slice(0, MAX_EFFECTS_PER_CLOCK)) {
    if (effect.type === 'SPAWN_CLOCK') {
      if (!effect.name || !effect.consequence) continue
      const maxTicks = clamp(Math.round(effect.maxTicks ?? SPAWN_CLOCK_MIN_TICKS), SPAWN_CLOCK_MIN_TICKS, SPAWN_CLOCK_MAX_TICKS)
      const newClock = await db.clock.create({
        data: {
          campaignId: sourceClock.campaignId,
          name: effect.name.trim().slice(0, 200),
          consequence: effect.consequence.trim().slice(0, 1000),
          category: effect.category?.trim().slice(0, 100) || null,
          maxTicks,
          currentTicks: 0,
          // Chains into the same continuing-agenda concept #104 built for
          // faction ambitions: the root clock's own id carries forward as
          // the shared grouping key for every stage that follows it.
          agendaId: sourceClock.agendaId ?? sourceClock.id,
        },
      })
      changes.push({
        entityType: 'CLOCK',
        entityId: newClock.id,
        entityName: newClock.name,
        campaignId: sourceClock.campaignId,
        field: 'spawned',
        previousValue: '(none)',
        newValue: newClock.name,
        reason: effect.reason || `Continues from ${sourceClock.name}'s completion`,
        significant: true,
        importance: 'NORMAL',
        origin: 'clockResolution',
      })
      continue
    }

    if (effect.type === 'LOCATION_EFFECT') {
      if (!effect.targetLocationName || !Number.isFinite(effect.conditionDelta)) continue
      const resolution = resolveEntityByNameOrId(locations, effect.targetLocationName)
      if (resolution.kind !== 'found') continue

      const delta = clamp(Math.round(effect.conditionDelta!), -MAX_LOCATION_CONDITION_DELTA, MAX_LOCATION_CONDITION_DELTA)
      if (delta === 0) continue

      const current = await db.location.findUnique({ where: { id: resolution.entity.id }, select: { conditionScore: true } })
      if (!current) continue
      const nextScore = clamp(current.conditionScore + delta, 0, 100)
      if (nextScore === current.conditionScore) continue

      await db.location.update({ where: { id: resolution.entity.id }, data: { conditionScore: nextScore } })
      changes.push({
        entityType: 'LOCATION_CONDITION',
        entityId: resolution.entity.id,
        entityName: resolution.entity.name,
        campaignId: sourceClock.campaignId,
        field: 'conditionScore',
        previousValue: current.conditionScore,
        newValue: nextScore,
        reason: effect.reason || `${sourceClock.name} completing has real consequences here`,
        significant: true,
        importance: Math.abs(delta) >= 10 ? 'MAJOR' : 'NORMAL',
        origin: 'clockResolution',
      })
      continue
    }

    if (effect.type === 'FACTION_EFFECT') {
      if (!effect.targetFactionName) continue
      const resolution = resolveEntityByNameOrId(factions, effect.targetFactionName)
      if (resolution.kind !== 'found') continue
      const faction = resolution.entity

      const resourceDelta = clamp(Math.round(effect.resourceDelta ?? 0), -MAX_FACTION_STAT_DELTA, MAX_FACTION_STAT_DELTA)
      const stabilityDelta = clamp(Math.round(effect.stabilityDelta ?? 0), -MAX_FACTION_STAT_DELTA, MAX_FACTION_STAT_DELTA)
      const militaryDelta = clamp(Math.round(effect.militaryDelta ?? 0), -MAX_FACTION_STAT_DELTA, MAX_FACTION_STAT_DELTA)
      const threatLevelDelta = clamp(Math.round(effect.threatLevelDelta ?? 0), -MAX_THREAT_LEVEL_DELTA, MAX_THREAT_LEVEL_DELTA)
      if (resourceDelta === 0 && stabilityDelta === 0 && militaryDelta === 0 && threatLevelDelta === 0) continue

      const newResources = clamp(faction.resources + resourceDelta, 0, 100)
      const newStability = clamp(faction.stability + stabilityDelta, 0, 100)
      const newMilitary = clamp(faction.military + militaryDelta, 0, 100)
      const newThreatLevel = clamp(faction.threatLevel + threatLevelDelta, 1, 5)

      await db.faction.update({
        where: { id: faction.id },
        data: { resources: newResources, stability: newStability, military: newMilitary, threatLevel: newThreatLevel },
      })
      changes.push({
        entityType: 'FACTION',
        entityId: faction.id,
        entityName: faction.name,
        campaignId: sourceClock.campaignId,
        field: 'clockResolutionEffect',
        previousValue: `res${faction.resources}/stab${faction.stability}/mil${faction.military}/threat${faction.threatLevel}`,
        newValue: `res${newResources}/stab${newStability}/mil${newMilitary}/threat${newThreatLevel}`,
        reason: effect.reason || `${sourceClock.name} completing directly affects ${faction.name}`,
        significant: true,
        importance: 'NORMAL',
        origin: 'clockResolution',
      })
      continue
    }
  }

  return changes
}

interface GenericCompletedClock {
  id: string
  name: string
  description: string | null
  consequence: string | null
  gmNotes: string | null
  category: string | null
  agendaId: string | null
}

/**
 * Orchestrates the AI call + apply + event pipeline for every GENERIC
 * (non-ambition) clock that just completed this turn. Called from
 * worldTurn.ts right after checkAndResolveCompletedClocks, which has
 * already created each clock's narrated TimelineEvent and marked it
 * resolved regardless of anything below — this only ever ADDS mechanical
 * follow-through on top, never gates the base completion on it.
 *
 * Per-clock, not batched: one clock's AI call failing (timeout, malformed
 * response) is isolated from the others, and each clock gets its own
 * grounded context (only ITS OWN consequence text, not every completed
 * clock's at once).
 */
export async function resolveGenericClockEffects(
  campaignId: string,
  // #437: the SIMULATION turn — one phase of a world turn.
  currentTurn: SimTurn,
  completedClocks: GenericCompletedClock[]
): Promise<WorldChange[]> {
  if (completedClocks.length === 0) return []

  const [campaign, locations, factions] = await Promise.all([
    prisma.campaign.findUnique({ where: { id: campaignId }, select: { title: true, universe: true } }),
    prisma.location.findMany({ where: { campaignId }, select: { id: true, name: true } }),
    prisma.faction.findMany({
      where: { campaignId, isActive: true },
      select: { id: true, name: true, resources: true, stability: true, military: true, threatLevel: true },
    }),
  ])
  if (!campaign) return []

  const knownLocationNames = locations.map((l) => l.name)
  const knownFactionNames = factions.map((f) => f.name)

  const allChanges: WorldChange[] = []

  for (const clock of completedClocks) {
    try {
      const effects = await generateClockResolutionEffects(campaignId, {
        campaignTitle: campaign.title,
        universe: campaign.universe || 'Unspecified',
        clockName: clock.name,
        clockDescription: clock.description,
        clockConsequence: clock.consequence,
        clockGmNotes: clock.gmNotes,
        clockCategory: clock.category,
        knownLocationNames,
        knownFactionNames,
      })
      if (!effects || effects.length === 0) continue

      const changes = await applyClockResolutionEffects(
        prisma,
        currentTurn,
        { id: clock.id, name: clock.name, campaignId, agendaId: clock.agendaId },
        effects,
        locations,
        factions
      )
      if (changes.length === 0) continue

      allChanges.push(...changes)
      await persistWorldEvents(campaignId, currentTurn, changes)
      await logSignificantChanges(campaignId, currentTurn, changes)
      await syncWikiEntriesForChanges(campaignId, currentTurn, changes)
      console.log(`  ⚙️ ${clock.name} completion produced ${changes.length} mechanical effect(s)`)
    } catch (error) {
      // Never lets one clock's failure block the turn or the other
      // completed clocks in this same batch — the clock already resolved
      // into its narrated event regardless (checkAndResolveCompletedClocks
      // ran before this), so the worst case here is a missed mechanical
      // follow-through, not an unacknowledged completion.
      console.error(`  ⚠️ Clock resolution effects failed for "${clock.name}" (clock still resolved via its narrated event):`, error)
    }
  }

  return allChanges
}
