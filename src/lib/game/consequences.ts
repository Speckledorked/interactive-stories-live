// src/lib/game/consequences.ts
// Player-action consequence tracking for NPCs and Factions.
//
// Builds on the Phase 1 world tick system (worldTick.ts, tick/types.ts's
// WorldChange, tick/historyLog.ts, tick/wikiSync.ts). Where the world tick
// moves entities along their own autonomous goals, this module originates
// NEW facts from what the player actually did to an entity in a scene —
// sparing/killing/betraying/favoring/etc — and applies them to the same
// state the tick reads (NPC.goals/relationship/importance, Faction's 4
// tracked fields), then runs them through the identical significance ->
// history -> wiki pipeline the tick uses. No parallel systems.

import { prisma } from '@/lib/prisma'
import type { NPC, Faction } from '@prisma/client'
import { extractConsequences, ExtractedConsequence, ConsequenceAction } from '@/lib/ai/consequenceExtraction'
import { logSignificantChanges } from './tick/historyLog'
import { syncWikiEntriesForChanges } from './tick/wikiSync'
import { persistWorldEvents } from './tick/worldEventLog'
import { MAJOR_IMPORTANCE_THRESHOLD } from './tick/npcTick'
import { WorldChange, clamp } from './tick/types'
import { resolveEntityByNameOrId } from './entityResolution'

// Consequences that redefine an NPC's relationship to the party outright —
// these always graduate a minor NPC into the simulated set, regardless of
// the LLM's stated intensity, because they're structurally irreversible or
// relationship-defining. Anything else only escalates when the LLM itself
// judged the moment "major" — this is what keeps the cap meaningful; a
// player casually sparing a random mook shouldn't inflate the simulated set.
const ALWAYS_ESCALATE_ACTIONS = new Set<ConsequenceAction>(['KILLED', 'BETRAYED', 'RECRUITED'])

export function shouldEscalateImportance(action: ConsequenceAction, intensity: string, currentImportance: number): boolean {
  if (currentImportance >= MAJOR_IMPORTANCE_THRESHOLD) return false
  return ALWAYS_ESCALATE_ACTIONS.has(action) || intensity === 'major'
}

// Deterministic per-action deltas to Faction's 3 tracked numeric fields,
// scaled by the LLM-reported intensity — mirrors factionTick.ts's
// goal-driven delta table, just keyed by player action instead of goal.
const FACTION_ACTION_DELTAS: Record<ConsequenceAction, { resources: number; stability: number; military: number }> = {
  SPARED:     { resources: 0,  stability: 1,  military: 0 },
  KILLED:     { resources: 0,  stability: -3, military: -2 },
  BETRAYED:   { resources: -2, stability: -3, military: 0 },
  FAVORED:    { resources: 3,  stability: 2,  military: 0 },
  ROBBED:     { resources: -4, stability: -1, military: 0 },
  HUMILIATED: { resources: 0,  stability: -2, military: -1 },
  THREATENED: { resources: 0,  stability: -1, military: 1 },
  RECRUITED:  { resources: 0,  stability: 1,  military: 1 },
  SABOTAGED:  { resources: -3, stability: -2, military: -2 },
  RESCUED:    { resources: 1,  stability: 2,  military: 0 },
}

const INTENSITY_MULTIPLIER: Record<string, number> = { minor: 0.5, moderate: 1, major: 1.75 }

function importanceForConsequence(action: ConsequenceAction, intensity: string): 'NORMAL' | 'MAJOR' {
  return ALWAYS_ESCALATE_ACTIONS.has(action) || intensity === 'major' ? 'MAJOR' : 'NORMAL'
}

// Entity resolution used to be hand-rolled here as
// `findFirst({equals}) ?? findFirst({contains})` — two bugs at once, both
// found live, not just in review:
// 1. `promiseA ?? promiseB` evaluates to promiseA unconditionally, since a
//    Promise object is never null/undefined — `??` only falls through on
//    an actual nullish value, not on "resolves to null". The `contains`
//    fallback was therefore dead code the entire time; a non-exact name
//    (an AI paraphrase, a typo, different casing beyond simple case-fold)
//    always resolved to nothing rather than ever reaching the fallback.
// 2. Even if that were fixed, `contains` is exactly the unsafe match
//    entityResolution.ts was built to replace — it can cross-match an
//    entity whose name is a substring of another's (e.g. "Bob" matching
//    "Bobby's Assistant"). See resolveEntityByNameOrId below, the same
//    exact/fuzzy-with-confidence-gate resolver every other AI write-back
//    applier (worldUpdaters/npcs.ts, factions.ts, characters.ts) uses.

export function applyNpcConsequence(npc: NPC, consequence: ExtractedConsequence): { updateData: any; changes: WorldChange[] } {
  const updateData: any = {}
  const changes: WorldChange[] = []
  const importance = importanceForConsequence(consequence.action, consequence.intensity)

  if (consequence.updatedGoal && consequence.updatedGoal !== npc.goals) {
    updateData.goals = consequence.updatedGoal
    // A changed motive starts its pursuit over — same rule as stateUpdater's
    // goal handling, so progress toward the old goal never bleeds into the new.
    updateData.goalProgress = 0
    changes.push({
      entityType: 'NPC', entityId: npc.id, entityName: npc.name, campaignId: npc.campaignId,
      field: 'goals', previousValue: npc.goals || '(none)', newValue: consequence.updatedGoal,
      reason: consequence.reason, significant: true, importance, origin: 'consequence',
      originLocationId: npc.locationId,
    })
  }

  if (consequence.updatedRelationship && consequence.updatedRelationship !== npc.relationship) {
    updateData.relationship = consequence.updatedRelationship
    changes.push({
      entityType: 'NPC', entityId: npc.id, entityName: npc.name, campaignId: npc.campaignId,
      field: 'relationship', previousValue: npc.relationship || '(none)', newValue: consequence.updatedRelationship,
      reason: consequence.reason, significant: true, importance, origin: 'consequence',
      originLocationId: npc.locationId,
    })
  }

  if (shouldEscalateImportance(consequence.action, consequence.intensity, npc.importance)) {
    updateData.importance = MAJOR_IMPORTANCE_THRESHOLD
    changes.push({
      entityType: 'NPC', entityId: npc.id, entityName: npc.name, campaignId: npc.campaignId,
      field: 'importance', previousValue: npc.importance, newValue: MAJOR_IMPORTANCE_THRESHOLD,
      reason: `${npc.name} became a major NPC after being ${consequence.action.toLowerCase()} by the party: ${consequence.reason}`,
      significant: true, importance: 'MAJOR', origin: 'consequence',
      originLocationId: npc.locationId,
    })
  }

  // #309: this comment used to say "always" but the code only fired when
  // changes.length === 0 — a last-resort fallback for the rare case
  // nothing else changed, not the ordinary path. Since the AI extraction
  // supplies an updatedGoal/updatedRelationship for most narratively
  // meaningful consequences, `npc.consequence` (the only WorldEvent type
  // npcDispositionTick.ts's ENDANGERED/PROTECTED classification reads)
  // was silently starved in the common case, not just the edge case the
  // comment described. "The party spared Grik" is a genuinely distinct
  // fact from "Grik's goal changed to X" — both belong in the log, so
  // this now always fires alongside whatever else changed, not only when
  // nothing else did.
  changes.push({
    entityType: 'NPC', entityId: npc.id, entityName: npc.name, campaignId: npc.campaignId,
    field: 'consequence', previousValue: '(none)', newValue: consequence.action,
    reason: consequence.reason, significant: true, importance, origin: 'consequence',
    originLocationId: npc.locationId,
  })

  return { updateData, changes }
}

export function applyFactionConsequence(faction: Faction, consequence: ExtractedConsequence): { updateData: any; changes: WorldChange[] } {
  const delta = FACTION_ACTION_DELTAS[consequence.action]
  const multiplier = INTENSITY_MULTIPLIER[consequence.intensity] ?? 1
  const importance = importanceForConsequence(consequence.action, consequence.intensity)

  const nextResources = clamp(faction.resources + Math.round(delta.resources * multiplier), 0, 100)
  const nextStability = clamp(faction.stability + Math.round(delta.stability * multiplier), 0, 100)
  const nextMilitary = clamp(faction.military + Math.round(delta.military * multiplier), 0, 100)

  const updateData: any = {}
  const changes: WorldChange[] = []

  const numericFields: Array<{ key: 'resources' | 'stability' | 'military'; prev: number; next: number }> = [
    { key: 'resources', prev: faction.resources, next: nextResources },
    { key: 'stability', prev: faction.stability, next: nextStability },
    { key: 'military', prev: faction.military, next: nextMilitary },
  ]

  for (const f of numericFields) {
    if (f.next === f.prev) continue
    updateData[f.key] = f.next
    changes.push({
      entityType: 'FACTION', entityId: faction.id, entityName: faction.name, campaignId: faction.campaignId,
      field: f.key, previousValue: f.prev, newValue: f.next,
      reason: `${faction.name}'s ${f.key} shifted after the party ${consequence.action.toLowerCase()} them: ${consequence.reason}`,
      significant: true, importance, origin: 'consequence',
    })
  }

  if (consequence.updatedFactionGoal && consequence.updatedFactionGoal !== faction.goal) {
    updateData.goal = consequence.updatedFactionGoal
    changes.push({
      entityType: 'FACTION', entityId: faction.id, entityName: faction.name, campaignId: faction.campaignId,
      field: 'goal', previousValue: faction.goal, newValue: consequence.updatedFactionGoal,
      reason: consequence.reason, significant: true, importance, origin: 'consequence',
    })
  }

  if (changes.length === 0) {
    changes.push({
      entityType: 'FACTION', entityId: faction.id, entityName: faction.name, campaignId: faction.campaignId,
      field: 'consequence', previousValue: '(none)', newValue: consequence.action,
      reason: consequence.reason, significant: true, importance, origin: 'consequence',
    })
  }

  return { updateData, changes }
}

/**
 * Apply a batch of already-extracted consequences to the database. Pure-ish:
 * reads current entity state, computes new state deterministically from the
 * consequence's action/intensity, writes it, and reports what changed.
 */
export async function applyConsequences(
  campaignId: string,
  consequences: ExtractedConsequence[]
): Promise<WorldChange[]> {
  const changes: WorldChange[] = []
  if (consequences.length === 0) return changes

  // Fetched once for the whole batch, not once per consequence —
  // resolveEntityByNameOrId is pure/synchronous specifically so callers can
  // do this (see its own doc comment) instead of a DB round-trip per name.
  // If a later consequence in this same batch affects an entity an earlier
  // one already updated, the in-memory record is kept fresh via
  // Object.assign after each write (below) rather than re-querying — same
  // correctness as a fresh fetch, one query instead of N.
  const [npcs, factions] = await Promise.all([
    prisma.nPC.findMany({ where: { campaignId } }),
    prisma.faction.findMany({ where: { campaignId } }),
  ])

  for (const consequence of consequences) {
    if (consequence.entityType === 'NPC') {
      const resolution = resolveEntityByNameOrId(npcs, consequence.entityName)
      if (resolution.kind !== 'found') {
        console.warn(
          resolution.kind === 'ambiguous'
            ? `⚠️ Consequence skipped — "${consequence.entityName}" matches multiple NPCs (${resolution.candidates.map(c => c.name).join(', ')}), not guessing`
            : `⚠️ Consequence skipped — NPC not found: ${consequence.entityName}`
        )
        continue
      }
      const npc = resolution.entity
      const { updateData, changes: npcChanges } = applyNpcConsequence(npc, consequence)
      if (Object.keys(updateData).length > 0) {
        await prisma.nPC.update({ where: { id: npc.id }, data: updateData })
        Object.assign(npc, updateData)
      }
      changes.push(...npcChanges)
    } else {
      const resolution = resolveEntityByNameOrId(factions, consequence.entityName)
      if (resolution.kind !== 'found') {
        console.warn(
          resolution.kind === 'ambiguous'
            ? `⚠️ Consequence skipped — "${consequence.entityName}" matches multiple factions (${resolution.candidates.map(c => c.name).join(', ')}), not guessing`
            : `⚠️ Consequence skipped — Faction not found: ${consequence.entityName}`
        )
        continue
      }
      const faction = resolution.entity
      const { updateData, changes: factionChanges } = applyFactionConsequence(faction, consequence)
      if (Object.keys(updateData).length > 0) {
        await prisma.faction.update({ where: { id: faction.id }, data: updateData })
        Object.assign(faction, updateData)
      }
      changes.push(...factionChanges)
    }
  }

  return changes
}

/**
 * Full pipeline: extract consequences from scene text, apply them, log the
 * significant ones to campaign history (RAG), and sync affected wiki
 * entries. This is the single function sceneResolver.ts calls.
 *
 * Grounds the extraction call in the campaign's full NPC/Faction roster —
 * not just the entities the base AI GM response happened to tag — since a
 * player can meaningfully spare/kill/befriend an NPC the schema-limited
 * npc_changes payload has no way to represent.
 */
export async function extractAndApplyConsequences(
  campaignId: string,
  turnNumber: number,
  sceneText: string
): Promise<{ consequencesFound: number; changes: WorldChange[]; historyEntriesCreated: number }> {
  const [npcs, factions] = await Promise.all([
    prisma.nPC.findMany({ where: { campaignId, isAlive: true }, select: { name: true } }),
    prisma.faction.findMany({ where: { campaignId }, select: { name: true } }),
  ])

  const consequences = await extractConsequences(sceneText, npcs, factions, campaignId)
  if (consequences.length === 0) {
    return { consequencesFound: 0, changes: [], historyEntriesCreated: 0 }
  }

  const changes = await applyConsequences(campaignId, consequences)
  await persistWorldEvents(campaignId, turnNumber, changes)
  const historyEntriesCreated = await logSignificantChanges(campaignId, turnNumber, changes)
  await syncWikiEntriesForChanges(campaignId, turnNumber, changes)

  return { consequencesFound: consequences.length, changes, historyEntriesCreated }
}
