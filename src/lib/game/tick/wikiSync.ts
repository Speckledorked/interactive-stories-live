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
import type { Prisma, WikiEntryType } from '@prisma/client'
import { WorldChange, parseFactionRelationships } from './types'
import { MAJOR_IMPORTANCE_THRESHOLD } from './npcTick'
import { describeStat } from '@/lib/ai/qualitativeStats'

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
      const npc = await prisma.nPC.findUnique({
        where: { id: entityId },
        // Fog of war applies to the links too: an undiscovered faction or
        // location must not be named on a page every member can read.
        include: {
          faction: { select: { name: true, isDiscovered: true } },
          location: { select: { name: true, isDiscovered: true } },
        },
      })
      // Fog of war: an undiscovered NPC gets no wiki entry — the wiki is
      // readable by every campaign member, not just admins.
      if (!npc || !npc.isDiscovered) continue
      const socialLine = await describeSocialTies(npc.socialTies)
      await syncNpcWikiEntry(
        campaignId,
        turnNumber,
        {
          ...npc,
          faction: npc.faction?.isDiscovered ? { name: npc.faction.name } : null,
          location: npc.location?.isDiscovered ? { name: npc.location.name } : null,
        },
        socialLine
      )
    } else {
      const faction = await prisma.faction.findUnique({
        where: { id: entityId },
        include: { territories: { where: { isDiscovered: true } } },
      })
      if (!faction || !faction.isDiscovered) continue
      await syncFactionWikiEntry(campaignId, turnNumber, faction)
    }
    synced++
  }

  return synced
}

// Phase 9: NPC society — resolve NPC.socialTies into a wiki-readable line,
// naming only DISCOVERED counterparts (an undiscovered ally's name is
// exactly the kind of thing fog of war exists to keep off the wiki).
async function describeSocialTies(rawTies: unknown): Promise<string | null> {
  const ties = parseFactionRelationships(rawTies)
  const otherIds = Object.keys(ties)
  if (otherIds.length === 0) return null

  const others = await prisma.nPC.findMany({
    where: { id: { in: otherIds }, isDiscovered: true },
    select: { id: true, name: true },
  })
  const nameById = new Map(others.map((o) => [o.id, o.name]))

  const allies = otherIds.filter((id) => ties[id].type === 'ALLY' && nameById.has(id)).map((id) => nameById.get(id)!)
  const rivals = otherIds.filter((id) => ties[id].type === 'RIVAL' && nameById.has(id)).map((id) => nameById.get(id)!)

  const parts: string[] = []
  if (allies.length > 0) parts.push(`Allied with ${allies.join(', ')}`)
  if (rivals.length > 0) parts.push(`At odds with ${rivals.join(', ')}`)
  return parts.length > 0 ? parts.join('; ') : null
}

async function syncNpcWikiEntry(
  campaignId: string,
  turnNumber: number,
  npc: {
    name: string; description: string | null; goals: string | null
    relationship: string | null; currentPlan: string | null; importance: number
    faction?: { name: string } | null
    location?: { name: string } | null
  },
  socialLine: string | null
): Promise<void> {
  // Cross-links so the wiki is navigable rather than a set of orphan pages.
  const related = buildRelatedEntries([
    npc.faction ? { id: npc.faction.name, type: 'FACTION', relationship: 'Affiliated with' } : null,
    npc.location ? { id: npc.location.name, type: 'LOCATION', relationship: 'Found at' } : null,
  ])
  const description = [
    npc.description || `${npc.name} is a character encountered during the adventure.`,
    `Current goal: ${npc.goals || 'Unknown'}`,
    `Relationship: ${npc.relationship || 'Neutral'}`,
    npc.currentPlan ? `Currently: ${npc.currentPlan}` : null,
    socialLine,
  ].filter(Boolean).join('\n\n')

  const wikiImportance = npc.importance >= MAJOR_IMPORTANCE_THRESHOLD ? 'major' : 'normal'

  await upsertWikiEntry({
    campaignId,
    turnNumber,
    entryType: 'NPC',
    name: npc.name,
    summary: npc.description || `A character in the story`,
    description,
    importance: wikiImportance,
    related,
  })
}

async function syncFactionWikiEntry(
  campaignId: string,
  turnNumber: number,
  faction: {
    name: string
    description: string | null
    goals: string | null
    currentPlan: string | null
    resources: number
    stability: number
    military: number
    goal: string
    territories: { name: string }[]
  }
): Promise<void> {
  const description = [
    faction.description || `${faction.name} is a group or organization in the world.`,
    faction.goals ? `Long-term goal: ${faction.goals}` : null,
    faction.currentPlan ? `Current plan: ${faction.currentPlan}` : null,
    // Fog of war: qualitative bands, not the exact numbers the simulation
    // uses internally — same treatment as the AI-facing prompt (see
    // qualitativeStats.ts), so the wiki can't hand players a precision the
    // AI itself is never allowed to narrate with.
    `Status: ${describeStat(faction.resources)} resources, ${describeStat(faction.stability)} stability, ${describeStat(faction.military)} military — pursuing ${faction.goal}`,
    faction.territories.length > 0 ? `Controls: ${faction.territories.map((t) => t.name).join(', ')}` : null,
  ].filter(Boolean).join('\n\n')

  const wikiImportance = faction.stability < 20 || faction.military > 80 ? 'major' : 'normal'

  const related = buildRelatedEntries(
    faction.territories.map(t => ({ id: t.name, type: 'LOCATION' as const, relationship: 'Controls' }))
  )

  await upsertWikiEntry({
    campaignId,
    turnNumber,
    entryType: 'FACTION',
    name: faction.name,
    summary: faction.description || `A faction in the campaign`,
    description,
    importance: wikiImportance,
    related,
  })
}

/**
 * Shared find-or-create for a wiki entry, keyed by (campaignId, entryType,
 * name) as everywhere else in this file. Extracted because syncNpcWikiEntry
 * and syncFactionWikiEntry differed only in which fields feed the same
 * update-or-create shape, not in the shape itself.
 */
async function upsertWikiEntry(input: {
  campaignId: string
  turnNumber: number
  entryType: WikiEntryType
  name: string
  summary: string
  description: string
  importance: 'major' | 'normal'
  related: WikiRelatedEntry[]
}): Promise<void> {
  const existing = await prisma.wikiEntry.findFirst({
    where: { campaignId: input.campaignId, entryType: input.entryType, name: input.name },
  })

  if (existing) {
    await prisma.wikiEntry.update({
      where: { id: existing.id },
      data: {
        description: input.description,
        importance: input.importance,
        lastSeenTurn: input.turnNumber,
        updatedAt: new Date(),
        changelog: appendWikiChangelog(existing.changelog, input.turnNumber, 'Details updated') as Prisma.InputJsonValue,
        relatedEntries: input.related as unknown as Prisma.InputJsonValue,
      },
    })
  } else {
    await prisma.wikiEntry.create({
      data: {
        campaignId: input.campaignId,
        entryType: input.entryType,
        relatedEntries: input.related as unknown as Prisma.InputJsonValue,
        name: input.name,
        summary: input.summary,
        description: input.description,
        tags: [],
        aliases: [],
        importance: input.importance,
        lastSeenTurn: input.turnNumber,
        createdBy: 'ai',
      },
    })
  }
}

/**
 * Append a turn-stamped entry to a wiki page's changelog.
 *
 * WikiEntry.changelog was declared and initialized as an empty array at
 * creation, and nothing ever appended to it — the wiki page's own display
 * code guards on `changelog.length > 0`, a condition that could never
 * become true (README #90). The field describes a genuinely useful thing
 * (how an entry evolved as the campaign went on) and the UI for it already
 * existed, so it's wired up rather than dropped.
 *
 * Bounded like every other append-only field in this codebase (see
 * textAppend.ts): oldest entries fall off rather than accumulating for the
 * life of the campaign. Pure — the caller persists the result.
 */
export const MAX_WIKI_CHANGELOG_ENTRIES = 20

export function appendWikiChangelog(
  existing: unknown,
  turnNumber: number,
  change: string
): Array<{ turn: number; change: string }> {
  const prior = Array.isArray(existing)
    ? (existing as Array<{ turn: number; change: string }>).filter(
        e => e && typeof e.change === 'string'
      )
    : []
  // A tick can re-sync an unchanged entry; don't record a no-op twice in a
  // row for the same turn.
  const last = prior[prior.length - 1]
  if (last && last.turn === turnNumber && last.change === change) return prior
  return [...prior, { turn: turnNumber, change }].slice(-MAX_WIKI_CHANGELOG_ENTRIES)
}

/**
 * A wiki cross-reference. `id` is the *name* of the related entry rather
 * than a row id: wiki entries are looked up by (campaignId, entryType,
 * name) everywhere else in this file, and an entry may not exist yet when
 * the link is written — a name resolves later, a dangling row id never
 * does.
 */
export interface WikiRelatedEntry {
  id: string
  type: 'NPC' | 'FACTION' | 'LOCATION' | 'CLOCK' | 'ITEM' | 'QUEST' | 'LORE' | 'CUSTOM'
  relationship: string
}

/**
 * Build the cross-reference list for a wiki entry, deduped and stable.
 *
 * WikiEntry.relatedEntries sat unwritten and unread for a long time
 * (README #90) while the wiki page had no way to navigate between related
 * things. Pure so the link-building rules are testable without a database.
 */
export function buildRelatedEntries(links: Array<WikiRelatedEntry | null | undefined>): WikiRelatedEntry[] {
  const seen = new Set<string>()
  const out: WikiRelatedEntry[] = []
  for (const link of links) {
    if (!link || !link.id?.trim()) continue
    const key = `${link.type}:${link.id.trim().toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...link, id: link.id.trim() })
  }
  return out
}
