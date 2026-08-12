// src/lib/game/chronicleContext.ts
// Lightweight, purpose-built data gathering for the campaign lobby's
// "World Chronicle" narration (see lib/ai/chronicleNarration.ts).
// Deliberately NOT buildWorldSummaryForAI (lib/ai/worldSummary.ts) — that
// builder is sized for the full scene-resolution prompt (every character,
// NPC, faction, location, clock, quest); this only needs a handful of
// atmosphere signals for a few sentences of flavor text.

import { prisma } from '@/lib/prisma'
import type { ChronicleNarrationInput, ChronicleGlance } from './chronicleTypes'

/**
 * Gathers the signals generateChronicleNarration needs, or null if the
 * campaign/worldMeta doesn't exist. Every sub-query degrades gracefully
 * (missing weather, no active wars, no recent events) rather than
 * throwing — the caller (worldTurn.ts) treats a failed/empty generation
 * as "leave last turn's narration in place," never a broken page.
 */
export async function buildChronicleNarrationInput(campaignId: string): Promise<ChronicleNarrationInput | null> {
  const [campaign, worldMeta] = await Promise.all([
    prisma.campaign.findUnique({ where: { id: campaignId }, select: { title: true, universe: true } }),
    prisma.worldMeta.findUnique({ where: { campaignId }, select: { tension: true, phase: true } }),
  ])
  if (!campaign || !worldMeta) return null

  const [characters, factions, wars, recentEvents] = await Promise.all([
    // Weather: resolved from a living PC's current location. locationId is
    // the stable join (kept in sync with currentLocation on every write —
    // see resolution.ts's own comment on this exact fallback chain);
    // currentLocation (free-text) is the fallback for a character whose
    // locationId hasn't resolved yet.
    prisma.character.findMany({
      where: { campaignId, isAlive: true },
      select: {
        locationId: true,
        currentLocation: true,
        // #233: isDiscovered included so the read below can drop an
        // undiscovered location's weather rather than leaking it — same
        // fog-of-war boundary the faction/war queries above already
        // enforce, and the one worldSummary.ts enforces via a plain
        // `isDiscovered: true` where clause on its own location query.
        location: { select: { name: true, weather: true, weatherSeverity: true, isDiscovered: true } },
      },
    }),
    // Faction activity: highest-threat, discovered, active factions only —
    // a hidden villain faction's plans must never leak into lobby flavor
    // text before the party has actually discovered it (same fog-of-war
    // boundary lib/api/visibility.ts enforces for reads elsewhere).
    prisma.faction.findMany({
      where: { campaignId, isActive: true, isDiscovered: true },
      orderBy: { threatLevel: 'desc' },
      take: 3,
      select: { name: true, archetype: true, goal: true, stability: true, threatLevel: true, currentPlan: true },
    }),
    // Conflicts: active wars where BOTH sides are discovered — same
    // fog-of-war reasoning as factions above.
    prisma.war.findMany({
      where: {
        campaignId,
        status: 'ESCALATING',
        attacker: { isDiscovered: true },
        defender: { isDiscovered: true },
      },
      take: 2,
      select: {
        name: true,
        momentum: true,
        status: true,
        attacker: { select: { name: true } },
        defender: { select: { name: true } },
      },
    }),
    // Recent happenings: the same PUBLIC|MIXED-visibility TimelineEvent
    // feed away-recap.ts already reads — the closest thing this app has to
    // a "rumor" concept (RUMORS is a wiki tab backed by this same feed,
    // not a distinct WikiEntryType).
    prisma.timelineEvent.findMany({
      where: { campaignId, visibility: { in: ['PUBLIC', 'MIXED'] } },
      orderBy: { turnNumber: 'desc' },
      take: 3,
      select: { title: true, summaryPublic: true },
    }),
  ])

  const withLocation = characters.find(c => c.location?.isDiscovered) ?? null
  const weather = withLocation?.location
    ? {
        locationName: withLocation.location.name,
        condition: withLocation.location.weather as string,
        severity: withLocation.location.weatherSeverity,
      }
    : null

  return {
    campaignTitle: campaign.title,
    universe: campaign.universe || 'Generic Fantasy',
    tension: worldMeta.tension,
    phase: worldMeta.phase,
    weather,
    factionSignals: factions.map(f => ({
      name: f.name,
      archetype: f.archetype,
      goal: f.goal,
      stability: f.stability,
      threatLevel: f.threatLevel,
      currentPlan: f.currentPlan,
    })),
    activeWars: wars.map(w => ({
      name: w.name,
      attackerName: w.attacker.name,
      defenderName: w.defender.name,
      momentum: w.momentum,
      status: w.status,
    })),
    recentEvents: recentEvents.map(e => ({ title: e.title, summaryPublic: e.summaryPublic })),
  }
}

/**
 * Plain-data derivation of the lobby's "World at a Glance" tile facts,
 * off the exact same input already gathered for the AI narration prompt —
 * no new query, no AI call, can't fail. Called unconditionally whenever
 * buildChronicleNarrationInput succeeds, regardless of whether the AI
 * narration itself does.
 */
export function deriveChronicleGlance(input: ChronicleNarrationInput): ChronicleGlance {
  const topFaction = input.factionSignals[0] ?? null
  return {
    weatherLabel: input.weather ? `${input.weather.condition} in ${input.weather.locationName}` : null,
    weatherLocationName: input.weather?.locationName ?? null,
    topFaction: topFaction ? { name: topFaction.name, threatLevel: topFaction.threatLevel } : null,
    activeConflictCount: input.activeWars.length,
    recentEventCount: input.recentEvents.length,
  }
}
