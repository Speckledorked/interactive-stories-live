// src/lib/wiki/entitySummaries.ts
//
// BUG-006/BUG-007 (#167/#168): WikiEntry.summary was written once at
// creation from the same raw field that also seeds description's first
// paragraph, then never touched again by either write path
// (sceneResolver.ts's updateWikiEntries, tick/wikiSync.ts's
// syncWikiEntriesForChanges) — only description was refreshed on update.
// That's why summary and description read as duplicates (same source text
// at birth) and why summary specifically looked frozen no matter how much
// the campaign moved on.
//
// These builders produce a short CURRENT-STATE line, distinct in both
// purpose and length from the fuller accumulated `description` each sync
// already assembles, and are called from every create AND update branch in
// both write paths so a summary is genuinely live, not a one-time snapshot.
// Pure/testable, matching this codebase's deterministic-template
// (no extra AI call) convention for wiki sync.

import { describeStat } from '@/lib/ai/qualitativeStats'

export function buildNpcWikiSummary(npc: {
  relationship?: string | null
  currentPlan?: string | null
  goals?: string | null
}): string {
  const stance = npc.relationship || 'Neutral'
  const activity = npc.currentPlan || npc.goals
  return activity ? `${stance} toward the party. Currently: ${activity}` : `${stance} toward the party.`
}

export function buildFactionWikiSummary(faction: {
  resources: number
  stability: number
  military: number
  goal: string
}): string {
  return `${describeStat(faction.resources)} resources, ${describeStat(faction.stability)} stability, ${describeStat(faction.military)} military — pursuing ${faction.goal}.`
}

export function buildClockWikiSummary(clock: {
  currentTicks: number
  maxTicks: number
  description?: string | null
}): string {
  const progress = `${clock.currentTicks}/${clock.maxTicks} ticks`
  return clock.description ? `${clock.description} (${progress})` : progress
}

export function buildLocationWikiSummary(location: {
  description?: string | null
  locationType?: string | null
}): string {
  if (!location.locationType) return location.description || 'A location in the world.'
  return location.description ? `${location.locationType} — ${location.description}` : location.locationType
}

export function buildQuestWikiSummary(quest: { status: string; objective?: string | null; description?: string | null }): string {
  const statusLine = quest.status === 'ACTIVE' ? 'In progress' : quest.status.charAt(0) + quest.status.slice(1).toLowerCase()
  const focus = quest.objective || quest.description
  return focus ? `${statusLine} — ${focus}` : statusLine
}

export function buildItemWikiSummary(itemDescription: string): string {
  return itemDescription.split('\n')[0]
}
