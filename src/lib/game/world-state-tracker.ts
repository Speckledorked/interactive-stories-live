// src/lib/game/world-state-tracker.ts
// Tracks world state changes made by the AI for transparency

import { prisma } from '@/lib/prisma'
import type { WorldStateChange } from '@/components/scene/AITransparencyPanel'
import { NotificationService } from '@/lib/notifications/notification-service'
import type { AdherenceResult } from './outcomeAdherence'
import type { MoveVarietyResult } from './moveVariety'

interface WorldStateSnapshot {
  npcs: Record<string, any>
  factions: Record<string, any>
  clocks: Record<string, any>
  characters: Record<string, any>
  /** Categories whose read hit ENTITY_READ_CAP — see fetchCampaignEntities. */
  truncated?: Partial<Record<'npcs' | 'factions' | 'clocks' | 'characters', boolean>>
}

/**
 * Per-table ceiling on the diff read (#420).
 *
 * This whole module is a DISPLAY-ONLY transparency panel, and it ran four
 * unprojected, unbounded `findMany` calls twice per scene resolution — the
 * full NPC, faction, clock and character rows of the campaign, including
 * every long text column the diff never looks at, on the request path of
 * the single hottest operation in the app. A campaign large enough to hurt
 * is exactly the campaign where the panel matters least.
 *
 * Generous rather than tight: the cap is a backstop against a pathological
 * campaign, not a paging strategy. When it is hit, removal detection for
 * that category is suppressed (see diffSection) — outside the window, an
 * entity that fell off the end is indistinguishable from one that was
 * deleted, and inventing "NPC removed from the campaign" out of a LIMIT is
 * worse than saying nothing.
 */
export const ENTITY_READ_CAP = 500

/**
 * The exact columns the diff below reads, and nothing else. Projecting is
 * half the fix — `findMany({ where })` selects every column, so this used
 * to drag NPC/Faction/Character description and plan text through the
 * request twice per resolution to compare four scalars.
 */
const NPC_DIFF_SELECT = {
  id: true, name: true, description: true, currentLocation: true, goals: true, isAlive: true,
} as const
const FACTION_DIFF_SELECT = {
  id: true, name: true, description: true, resources: true, influence: true, threatLevel: true, currentPlan: true,
} as const
const CLOCK_DIFF_SELECT = {
  id: true, name: true, description: true, currentTicks: true, maxTicks: true,
} as const
const CHARACTER_DIFF_SELECT = {
  id: true, name: true, stats: true, perks: true, harm: true, consequences: true,
} as const

/**
 * The same 4-table read used both to snapshot state before AI resolution
 * and to read it back after, for diffing. Ordered by id so the before and
 * after windows are the same window whenever nothing changed.
 */
async function fetchCampaignEntities(campaignId: string) {
  const page = { where: { campaignId }, orderBy: { id: 'asc' as const }, take: ENTITY_READ_CAP }
  const [npcs, factions, clocks, characters] = await Promise.all([
    prisma.nPC.findMany({ ...page, select: NPC_DIFF_SELECT }),
    prisma.faction.findMany({ ...page, select: FACTION_DIFF_SELECT }),
    prisma.clock.findMany({ ...page, select: CLOCK_DIFF_SELECT }),
    prisma.character.findMany({ ...page, select: CHARACTER_DIFF_SELECT }),
  ])

  return {
    npcs,
    factions,
    clocks,
    characters,
    truncated: {
      npcs: npcs.length === ENTITY_READ_CAP,
      factions: factions.length === ENTITY_READ_CAP,
      clocks: clocks.length === ENTITY_READ_CAP,
      characters: characters.length === ENTITY_READ_CAP,
    },
  }
}

/**
 * Capture the current world state before AI resolution
 */
export async function captureWorldStateSnapshot(campaignId: string): Promise<WorldStateSnapshot> {
  const { npcs, factions, clocks, characters, truncated } = await fetchCampaignEntities(campaignId)

  return {
    npcs: Object.fromEntries(npcs.map(n => [n.id, n])),
    factions: Object.fromEntries(factions.map(f => [f.id, f])),
    clocks: Object.fromEntries(clocks.map(c => [c.id, c])),
    characters: Object.fromEntries(characters.map(c => [c.id, c])),
    truncated,
  }
}

/**
 * Compare world state before and after AI resolution
 * Returns a list of changes for transparency
 */
export async function detectWorldStateChanges(
  campaignId: string,
  beforeSnapshot: WorldStateSnapshot
): Promise<WorldStateChange[]> {
  const changes: WorldStateChange[] = []

  // Get current state
  const { npcs, factions, clocks, characters, truncated } = await fetchCampaignEntities(campaignId)

  // An id missing from a truncated window fell off a LIMIT, not out of the
  // fiction. Reporting it as a removal would be a fabricated world event.
  const npcWindowIsComplete = !truncated.npcs && !beforeSnapshot.truncated?.npcs

  // Detect NPC changes
  for (const npc of npcs) {
    const before = beforeSnapshot.npcs[npc.id]

    if (!before) {
      changes.push({
        category: 'npc',
        type: 'added',
        entityName: npc.name,
        details: `New NPC introduced: ${npc.description || 'No description'}`,
        impact: 'moderate'
      })
    } else {
      // Check for modifications
      const modifications: string[] = []

      if (before.description !== npc.description && npc.description) {
        modifications.push('description updated')
      }
      if (before.currentLocation !== npc.currentLocation && npc.currentLocation) {
        modifications.push(`moved to ${npc.currentLocation}`)
      }
      if (before.goals !== npc.goals && npc.goals) {
        modifications.push('goals changed')
      }
      if (before.isAlive !== npc.isAlive) {
        modifications.push(npc.isAlive ? 'revived' : 'died')
      }

      if (modifications.length > 0) {
        changes.push({
          category: 'npc',
          type: 'modified',
          entityName: npc.name,
          details: modifications.join(', '),
          impact: modifications.includes('died') ? 'major' : 'minor'
        })
      }
    }
  }

  // Detect removed NPCs
  const npcIds = new Set(npcs.map(n => n.id))
  for (const beforeId of npcWindowIsComplete ? Object.keys(beforeSnapshot.npcs) : []) {
    if (!npcIds.has(beforeId)) {
      const removed = beforeSnapshot.npcs[beforeId]
      changes.push({
        category: 'npc',
        type: 'removed',
        entityName: removed.name,
        details: 'NPC removed from the campaign',
        impact: 'moderate'
      })
    }
  }

  // Detect faction changes
  for (const faction of factions) {
    const before = beforeSnapshot.factions[faction.id]

    if (!before) {
      changes.push({
        category: 'faction',
        type: 'added',
        entityName: faction.name,
        details: `New faction: ${faction.description || 'No description'}`,
        impact: 'major'
      })
    } else {
      const modifications: string[] = []

      if (before.resources !== faction.resources) {
        const diff = faction.resources - before.resources
        modifications.push(`resources ${diff > 0 ? 'increased' : 'decreased'} by ${Math.abs(diff)}`)
      }
      if (before.influence !== faction.influence) {
        const diff = faction.influence - before.influence
        modifications.push(`influence ${diff > 0 ? 'increased' : 'decreased'} by ${Math.abs(diff)}`)
      }
      if (before.threatLevel !== faction.threatLevel) {
        modifications.push(`threat level changed to ${faction.threatLevel}`)
      }
      if (before.currentPlan !== faction.currentPlan && faction.currentPlan) {
        modifications.push('new plan: ' + faction.currentPlan)
      }

      if (modifications.length > 0) {
        changes.push({
          category: 'faction',
          type: 'modified',
          entityName: faction.name,
          details: modifications.join(', '),
          impact: 'moderate'
        })
      }
    }
  }

  // Detect clock changes
  for (const clock of clocks) {
    const before = beforeSnapshot.clocks[clock.id]

    if (!before) {
      changes.push({
        category: 'clock',
        type: 'added',
        entityName: clock.name,
        details: `New clock: ${clock.description || 'No description'} (${clock.currentTicks}/${clock.maxTicks})`,
        impact: 'moderate'
      })
    } else {
      if (before.currentTicks !== clock.currentTicks) {
        const ticksAdded = clock.currentTicks - before.currentTicks
        const isComplete = clock.currentTicks >= clock.maxTicks
        changes.push({
          category: 'clock',
          type: 'ticked',
          entityName: clock.name,
          details: `Advanced ${ticksAdded} tick(s): ${clock.currentTicks}/${clock.maxTicks}${isComplete ? ' - COMPLETE!' : ''}`,
          impact: isComplete ? 'major' : ticksAdded > 1 ? 'moderate' : 'minor'
        })
      }
    }
  }

  // Detect character changes (stats, perks, consequences)
  for (const character of characters) {
    const before = beforeSnapshot.characters[character.id]

    if (before) {
      const characterChanges: string[] = []

      // Check stats
      const beforeStats = before.stats as Record<string, number> || {}
      const afterStats = character.stats as Record<string, number> || {}

      for (const [stat, value] of Object.entries(afterStats)) {
        if (beforeStats[stat] !== value) {
          const change = value - (beforeStats[stat] || 0)
          if (change !== 0) {
            characterChanges.push(`${stat} ${change > 0 ? '+' : ''}${change}`)
          }
        }
      }

      // Check perks
      const beforePerks = (before.perks as any[]) || []
      const afterPerks = (character.perks as any[]) || []

      if (afterPerks.length > beforePerks.length) {
        const newPerks = afterPerks.slice(beforePerks.length)
        for (const perk of newPerks) {
          const perkName = typeof perk === 'string' ? perk : perk.name
          characterChanges.push(`gained perk: ${perkName}`)
        }
      }

      // Check harm
      if (before.harm !== character.harm) {
        const diff = character.harm - before.harm
        characterChanges.push(`harm ${diff > 0 ? 'increased' : 'decreased'} by ${Math.abs(diff)}`)
      }

      // Check consequences
      const beforeCons = (before.consequences as any) || {}
      const afterCons = (character.consequences as any) || {}

      const beforeEnemies = beforeCons.enemies || []
      const afterEnemies = afterCons.enemies || []
      if (afterEnemies.length > beforeEnemies.length) {
        const newEnemies = afterEnemies.slice(beforeEnemies.length)
        characterChanges.push(`new enemy: ${newEnemies.join(', ')}`)
      }

      const beforeDebts = beforeCons.debts || []
      const afterDebts = afterCons.debts || []
      if (afterDebts.length > beforeDebts.length) {
        const newDebts = afterDebts.slice(beforeDebts.length)
        characterChanges.push(`new debt: ${newDebts.join(', ')}`)
      }

      const beforePromises = beforeCons.promises || []
      const afterPromises = afterCons.promises || []
      if (afterPromises.length > beforePromises.length) {
        const newPromises = afterPromises.slice(beforePromises.length)
        characterChanges.push(`new promise: ${newPromises.join(', ')}`)
      }

      if (characterChanges.length > 0) {
        changes.push({
          category: 'character',
          type: 'modified',
          entityName: character.name,
          details: characterChanges.join(', '),
          impact: characterChanges.some(c => c.includes('stat') || c.includes('perk')) ? 'major' : 'moderate'
        })
      }
    }
  }

  return changes
}

/**
 * Store world state changes in the scene for display.
 *
 * outcomeAdherence (#91) and moveVariety (#232) are sibling keys in the
 * same untyped `consequences` blob, not new DB columns — both share the
 * exact same lifecycle as worldStateChanges (one snapshot per resolution,
 * overwritten wholesale on the next one), so a new migration would only
 * add ceremony without changing that behavior.
 */
export async function storeWorldStateChanges(
  sceneId: string,
  changes: WorldStateChange[],
  outcomeAdherence?: AdherenceResult,
  moveVariety?: MoveVarietyResult
): Promise<void> {
  // Store in scene consequences field
  await prisma.scene.update({
    where: { id: sceneId },
    data: {
      consequences: {
        worldStateChanges: changes,
        ...(outcomeAdherence ? { outcomeAdherence } : {}),
        ...(moveVariety ? { moveVariety } : {})
      } as any
    }
  })
}

// NOTE: there is deliberately no getWorldStateChanges(sceneId) accessor.
// It existed here with no callers, and a caller was looked for rather than
// assumed absent: both real consumers (the story page and the campaign
// exporter) already hold the Scene row when they need its changes, so a
// fetch-by-id would only add an N+1 query. The shape extraction they
// actually share lives in worldStateChanges.ts, which is dependency-free
// on purpose — importing it from this module would drag Prisma into the
// client bundle.

/**
 * Create notifications for character progression changes
 */
export async function createCharacterProgressionNotifications(
  campaignId: string,
  characterId: string,
  changes: WorldStateChange[],
  sceneNumber?: number
): Promise<void> {
  // Get character and user info
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    include: { user: true }
  })

  if (!character) return

  // Filter for character progression changes
  const progressionChanges = changes.filter(
    c => c.category === 'character' && c.entityName === character.name
  )

  if (progressionChanges.length === 0) return

  // Create a notification for the player
  for (const change of progressionChanges) {
    let priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' = 'NORMAL'

    if (change.details.includes('stat') || change.details.includes('perk')) {
      priority = 'HIGH'
    }

    await NotificationService.createNotification({
      type: 'AI_RESPONSE_READY',
      title: `${character.name} has grown!`,
      message: `Your character has progressed: ${change.details}${sceneNumber ? ` (Scene ${sceneNumber})` : ''}`,
      userId: character.userId,
      campaignId,
      priority,
      actionUrl: `/campaigns/${campaignId}/characters/${characterId}`,
      metadata: {
        characterId,
        sceneNumber,
        changes: change.details
      },
      triggerSound: 'levelup'
    })
  }
}
