// src/lib/game/tick/wikiSync.ts
// World Sim Phase 2 — keep WikiEntry summaries/descriptions in sync with
// simulation state.
//
// Triggered by the exact same "significant" flag already used to gate RAG
// memory writes (see historyLog.ts) — no second threshold system. Whenever a
// tick or a player-action consequence produces a significant NPC/FACTION/
// LOCATION_CONDITION change, that entity's wiki entry is regenerated from
// current DB state.
//
// LOCATION_WEATHER is deliberately still excluded, not an oversight: unlike
// every other entityType here, weatherTick.ts marks EVERY weather change
// significant: true, every turn, in every campaign — wiring that in would
// mean a wiki resync (and a changelog entry) on every single tick, which is
// churn, not signal, and isn't the kind of thing a "the world remembers"
// chronicle should be capturing turn to turn. LOCATION_CONDITION is
// different: locationConditionTick.ts only marks it significant on an
// actual war-driven ravaging (peacetime recovery and mere contest strain
// are routine, same tier as weather's own wobble), which is exactly the
// bar every other entry in this file already uses.

import { prisma } from '@/lib/prisma'
import type { Prisma, WikiEntryType } from '@prisma/client'
import { WorldChange } from './types'
import { TIE_INCLUDE, npcTies } from '../tieGraph'
import { MAJOR_IMPORTANCE_THRESHOLD } from './npcTick'
import { deriveConditionTags } from './locationConditionTick'
import { describeStat } from '@/lib/ai/qualitativeStats'
import { buildNpcWikiSummary, buildFactionWikiSummary, buildLocationWikiSummary } from '@/lib/wiki/entitySummaries'

/**
 * Regenerate WikiEntry summary/description for every NPC/Faction that had a
 * significant change in this batch. Follows the same deterministic-template
 * pattern already used for Clock/Location wiki sync in sceneResolver.ts —
 * no extra AI call, just a refresh from current field values.
 *
 * #236 (adversarial audit): this used to have no per-entity error
 * isolation at all — a transient DB error on any ONE entity's sync (a
 * dropped connection, a constraint violation) threw straight out of the
 * whole function, which `worldTick.ts` awaits with nothing catching it.
 * That meant a single bad wiki sync could abort the rest of that world
 * turn's processing (clock advancement, offscreen narration, chronicle
 * generation never run) even though the tick's own simulation-state
 * transaction had already committed cleanly — exactly the kind of
 * partial, inconsistent result this function's own "best-effort, no
 * extra AI call" framing was never meant to risk. Each entity's sync is
 * now independently caught: one failure is logged and skipped, the rest
 * of the batch still runs.
 */
export async function syncWikiEntriesForChanges(
  campaignId: string,
  turnNumber: number,
  changes: WorldChange[]
): Promise<number> {
  const significantEntityIds = new Set(
    changes
      .filter((c) => c.significant && (c.entityType === 'NPC' || c.entityType === 'FACTION' || c.entityType === 'LOCATION_CONDITION'))
      .map((c) => `${c.entityType}:${c.entityId}`)
  )

  let synced = 0

  for (const key of significantEntityIds) {
    const [entityType, entityId] = key.split(':') as ['NPC' | 'FACTION' | 'LOCATION_CONDITION', string]

    try {
      if (entityType === 'LOCATION_CONDITION') {
        const location = await prisma.location.findUnique({
          where: { id: entityId },
          include: { ownerFaction: { select: { name: true, isDiscovered: true } } },
        })
        // Fog of war: an undiscovered location gets no wiki entry, same as
        // an undiscovered NPC/faction above.
        if (!location || !location.isDiscovered) continue
        await syncLocationWikiEntry(campaignId, turnNumber, {
          ...location,
          ownerFaction: location.ownerFaction?.isDiscovered ? { name: location.ownerFaction.name } : null,
        })
      } else if (entityType === 'NPC') {
        const npc = await prisma.nPC.findUnique({
          where: { id: entityId },
          // Fog of war applies to the links too: an undiscovered faction or
          // location must not be named on a page every member can read.
          include: {
            faction: { select: { name: true, isDiscovered: true } },
            location: { select: { name: true, isDiscovered: true } },
            // #373: social ties are edge rows now.
            ...TIE_INCLUDE,
          },
        })
        // Fog of war: an undiscovered NPC gets no wiki entry — the wiki is
        // readable by every campaign member, not just admins.
        if (!npc || !npc.isDiscovered) continue
        const socialLine = await describeSocialTies(npcTies(npc))
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
    } catch (error) {
      console.error(`⚠️ Failed to sync wiki entry for ${key} (non-critical, continuing):`, error)
    }
  }

  return synced
}

// Phase 9: NPC society — resolve NPC.socialTies into a wiki-readable line,
// naming only DISCOVERED counterparts (an undiscovered ally's name is
// exactly the kind of thing fog of war exists to keep off the wiki).
async function describeSocialTies(ties: Record<string, { type: 'RIVAL' | 'ALLY' }>): Promise<string | null> {
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
    summary: buildNpcWikiSummary(npc),
    description,
    importance: wikiImportance,
    related,
    // Categorization: the wiki page groups each tab's list by an entry's
    // first tag — an NPC's most natural grouping is who they're with,
    // which the affiliation link already computed above.
    tags: [npc.faction ? npc.faction.name : 'Unaffiliated'],
  })
}

/**
 * FactionArchetype is a closed, SCREAMING_SNAKE_CASE enum (schema.prisma) —
 * this turns a value like "SECRET_SOCIETY" into "Secret Society" for
 * display as a wiki category tag. Pure so the formatting rule is testable
 * without a database.
 */
export function humanizeArchetype(archetype: string): string {
  return archetype
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ')
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
    archetype: string
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
    summary: buildFactionWikiSummary(faction),
    description,
    importance: wikiImportance,
    related,
    tags: [humanizeArchetype(faction.archetype)],
  })
}

/**
 * Only reached on a war-driven condition change (see this file's header
 * comment) — the same real-history moment sceneResolver.ts's own
 * every-scene Location sync doesn't reliably capture soon after it happens
 * away from any player scene. Reflects the location's current condition
 * band (RUINED/DAMAGED/STABLE/PROSPEROUS, plus CONTESTED) via
 * deriveConditionTags — the same derivation the admin reasoning route and
 * the integrity checks use, so the wiki can never show a tag the rest of
 * the simulation disagrees with.
 */
async function syncLocationWikiEntry(
  campaignId: string,
  turnNumber: number,
  location: {
    name: string
    description: string | null
    locationType: string | null
    conditionScore: number
    isContested: boolean
    ownerFaction?: { name: string } | null
  }
): Promise<void> {
  const conditionTags = deriveConditionTags(location.conditionScore, location.isContested)
  const conditionLine = `Condition: ${describeStat(location.conditionScore)} (${conditionTags.join(', ').toLowerCase()})`

  const description = [
    location.description,
    location.locationType ? `Type: ${location.locationType}` : null,
    // Fog of war: only name the controlling faction if that faction is
    // itself discovered — territory shouldn't out a hidden faction's
    // existence any more than the AI's own prompt is allowed to.
    location.ownerFaction ? `Controlled by: ${location.ownerFaction.name}` : null,
    conditionLine,
  ].filter(Boolean).join('\n\n') || `${location.name} is a location in the world.`

  await upsertWikiEntry({
    campaignId,
    turnNumber,
    entryType: 'LOCATION',
    name: location.name,
    summary: buildLocationWikiSummary(location),
    description,
    // A location bad enough to trigger this sync at all (a war actively
    // ravaging it) is wiki-major by construction — this function is only
    // ever reached on that path, see the caller.
    importance: 'major',
    related: [],
    tags: location.locationType ? [location.locationType] : [],
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
  // The wiki page groups each tab's entry list by tags[0] — this must be
  // set on the UPDATE path too, not only at creation, or an entry that
  // already existed before this categorization landed would never pick up
  // a tag: nothing else ever re-creates it. Setting it on every sync is
  // what makes existing entries fall into their category retroactively,
  // the next time this same significant-change sync runs for them.
  tags: string[]
}): Promise<void> {
  const existing = await prisma.wikiEntry.findFirst({
    where: { campaignId: input.campaignId, entryType: input.entryType, name: input.name },
  })

  if (existing) {
    await prisma.wikiEntry.update({
      where: { id: existing.id },
      data: {
        summary: input.summary,
        description: input.description,
        importance: input.importance,
        tags: input.tags,
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
        tags: input.tags,
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
