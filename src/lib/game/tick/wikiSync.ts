// src/lib/game/tick/wikiSync.ts
// World Sim Phase 2 — keep WikiEntry summaries/descriptions in sync with
// simulation state.
//
// Triggered by the exact same "significant" flag already used to gate RAG
// memory writes (see historyLog.ts) — no second threshold system. Whenever a
// tick or a player-action consequence produces a significant NPC/FACTION
// change, that entity's wiki entry is regenerated from current DB state.
// Weather/location changes don't have an analogous requirement here (out of
// scope for this pass) so LOCATION_WEATHER changes are ignored.

import { prisma } from '@/lib/prisma'
import { WorldChange } from './types'
import { MAJOR_IMPORTANCE_THRESHOLD } from './npcTick'

/**
 * Regenerate WikiEntry summary/description for every NPC/Faction that had a
 * significant change in this batch. Follows the same deterministic-template
 * pattern already used for Clock/Location wiki sync in sceneResolver.ts —
 * no extra AI call, just a refresh from current field values.
 */
export async function syncWikiEntriesForChanges(
  campaignId: string,
  turnNumber: number,
  changes: WorldChange[]
): Promise<number> {
  const significantEntityIds = new Set(
    changes
      .filter((c) => c.significant && (c.entityType === 'NPC' || c.entityType === 'FACTION'))
      .map((c) => `${c.entityType}:${c.entityId}`)
  )

  let synced = 0

  for (const key of significantEntityIds) {
    const [entityType, entityId] = key.split(':') as ['NPC' | 'FACTION', string]

    if (entityType === 'NPC') {
      const npc = await prisma.nPC.findUnique({ where: { id: entityId } })
      if (!npc) continue
      await syncNpcWikiEntry(campaignId, turnNumber, npc)
    } else {
      const faction = await prisma.faction.findUnique({ where: { id: entityId } })
      if (!faction) continue
      await syncFactionWikiEntry(campaignId, turnNumber, faction)
    }
    synced++
  }

  return synced
}

async function syncNpcWikiEntry(
  campaignId: string,
  turnNumber: number,
  npc: { name: string; description: string | null; goals: string | null; relationship: string | null; currentPlan: string | null; importance: number }
): Promise<void> {
  const description = [
    npc.description || `${npc.name} is a character encountered during the adventure.`,
    `Current goal: ${npc.goals || 'Unknown'}`,
    `Relationship: ${npc.relationship || 'Neutral'}`,
    npc.currentPlan ? `Currently: ${npc.currentPlan}` : null,
  ].filter(Boolean).join('\n\n')

  const wikiImportance = npc.importance >= MAJOR_IMPORTANCE_THRESHOLD ? 'major' : 'normal'

  const existing = await prisma.wikiEntry.findFirst({
    where: { campaignId, entryType: 'NPC', name: npc.name },
  })

  if (existing) {
    await prisma.wikiEntry.update({
      where: { id: existing.id },
      data: { description, importance: wikiImportance, lastSeenTurn: turnNumber, updatedAt: new Date() },
    })
  } else {
    await prisma.wikiEntry.create({
      data: {
        campaignId,
        entryType: 'NPC',
        name: npc.name,
        summary: npc.description || `A character in the story`,
        description,
        tags: [],
        aliases: [],
        importance: wikiImportance,
        lastSeenTurn: turnNumber,
        createdBy: 'ai',
      },
    })
  }
}

async function syncFactionWikiEntry(
  campaignId: string,
  turnNumber: number,
  faction: { name: string; description: string | null; goals: string | null; currentPlan: string | null; resources: number; stability: number; military: number; goal: string }
): Promise<void> {
  const description = [
    faction.description || `${faction.name} is a group or organization in the world.`,
    faction.goals ? `Long-term goal: ${faction.goals}` : null,
    faction.currentPlan ? `Current plan: ${faction.currentPlan}` : null,
    `Status: resources ${faction.resources}/100, stability ${faction.stability}/100, military ${faction.military}/100 — pursuing ${faction.goal}`,
  ].filter(Boolean).join('\n\n')

  const wikiImportance = faction.stability < 20 || faction.military > 80 ? 'major' : 'normal'

  const existing = await prisma.wikiEntry.findFirst({
    where: { campaignId, entryType: 'FACTION', name: faction.name },
  })

  if (existing) {
    await prisma.wikiEntry.update({
      where: { id: existing.id },
      data: { description, importance: wikiImportance, lastSeenTurn: turnNumber, updatedAt: new Date() },
    })
  } else {
    await prisma.wikiEntry.create({
      data: {
        campaignId,
        entryType: 'FACTION',
        name: faction.name,
        summary: faction.description || `A faction in the campaign`,
        description,
        tags: [],
        aliases: [],
        importance: wikiImportance,
        lastSeenTurn: turnNumber,
        createdBy: 'ai',
      },
    })
  }
}
