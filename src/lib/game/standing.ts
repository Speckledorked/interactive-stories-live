// src/lib/game/standing.ts
// Urban Shadows faction standing: a character's social position with each
// faction, -3 (hunted) to +3 (honored). Standing SHIFTS come from scene
// outcomes (AI-reported, server-clamped). Standing WEIGHT is computed at
// roll time against live simulation state: a collapsed faction's regard
// is worthless, a war-weakened one's is worth less. That's the fusion —
// the offscreen tick changes what a player can roll without the tick
// ever writing a standing row.

import { Prisma } from '@prisma/client'
import { band } from '@/lib/game/tick/factionTick'

export const STANDING_MIN = -3
export const STANDING_MAX = 3

// One scene can move a relationship one step. Reputations are earned,
// not swung — same guardrail philosophy as capability growth caps.
export const MAX_SHIFT_PER_SCENE = 1

export interface StandingChange {
  faction_name: string
  delta: number // intended shift; server clamps to ±1 and bounds ±3
  reason: string
}

const STANDING_LABELS: Record<number, string> = {
  [-3]: 'hunted by',
  [-2]: 'hostile with',
  [-1]: 'distrusted by',
  [0]: 'unknown to',
  [1]: 'favored by',
  [2]: 'trusted by',
  [3]: 'honored by',
}

export function standingLabel(value: number): string {
  const clamped = Math.max(STANDING_MIN, Math.min(STANDING_MAX, Math.round(value)))
  return STANDING_LABELS[clamped]
}

/**
 * How much standing actually moves a roll, given the faction's LIVE
 * simulation state:
 *  - inactive (collapsed/absorbed): 0 — dead factions' regard means nothing
 *  - LOW influence (e.g. bled dry by a lost war): capped at ±1
 *  - otherwise: capped at ±2 (full ±3 standing still shows socially, but
 *    mechanical swing stays bounded alongside stat + capability mods)
 */
export function effectiveStandingModifier(
  value: number,
  factionIsActive: boolean,
  factionInfluence: number
): number {
  if (!factionIsActive) return 0
  const cap = band(factionInfluence) === 'LOW' ? 1 : 2
  return Math.max(-cap, Math.min(cap, value))
}

type Db = Prisma.TransactionClient

/**
 * The single writer for standing shifts. Resolves the faction by name
 * (discovered or not — earning a secret society's ire counts even before
 * the party knows its name), clamps the per-scene shift to ±1 and the
 * total to [-3, +3]. Unknown faction names are skipped — standing is
 * always with a real simulated faction, that's the point.
 */
export async function applyStandingChanges(
  db: Db,
  campaignId: string,
  characterId: string,
  characterName: string,
  changes: StandingChange[],
  log: string[] = []
): Promise<string[]> {
  for (const change of changes) {
    const name = change.faction_name?.trim()
    if (!name || !Number.isFinite(change.delta) || change.delta === 0) continue

    const faction = await db.faction.findFirst({
      where: { campaignId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true },
    })
    if (!faction) {
      console.warn(`  ❓ standing_changes: unknown faction "${name}" — skipped`)
      continue
    }

    const shift = Math.max(-MAX_SHIFT_PER_SCENE, Math.min(MAX_SHIFT_PER_SCENE, Math.round(change.delta)))
    const existing = await db.factionStanding.findUnique({
      where: { characterId_factionId: { characterId, factionId: faction.id } },
    })
    const before = existing?.value ?? 0
    const after = Math.max(STANDING_MIN, Math.min(STANDING_MAX, before + shift))
    if (after === before) continue

    await db.factionStanding.upsert({
      where: { characterId_factionId: { characterId, factionId: faction.id } },
      create: { campaignId, characterId, factionId: faction.id, value: after },
      update: { value: after },
    })
    log.push(`${characterName} is now ${standingLabel(after)} ${faction.name} (${change.reason})`)
  }
  return log
}

// ---------------------------------------------------------------------------
// Read-side shaping
// ---------------------------------------------------------------------------

export interface StandingRowForDisplay {
  value: number
  faction: { name: string; isActive: boolean; isDiscovered: boolean }
}

export interface StandingSummaryEntry {
  faction: string
  label: string // "honored by", "hostile with", ...
}

/**
 * Diegetic entries for the sheet and prompt. Neutral (0) rows are
 * omitted; standings with inactive factions are omitted too — the world
 * moved on, and showing them would leak that the relationship stopped
 * mattering before the fiction says why. Fog of war: undiscovered
 * factions never render (the character may have earned a secret enemy
 * they don't know about — the AI knows via the roll math, the sheet
 * doesn't).
 */
export function summarizeStandings(rows: StandingRowForDisplay[]): StandingSummaryEntry[] {
  return rows
    .filter(r => r.value !== 0 && r.faction.isActive && r.faction.isDiscovered)
    .sort((a, b) => b.value - a.value)
    .map(r => ({ faction: r.faction.name, label: standingLabel(r.value) }))
}
