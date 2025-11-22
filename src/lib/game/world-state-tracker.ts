// src/lib/game/world-state-tracker.ts
// Tracks world state changes made by the AI for transparency

import { prisma } from '@/lib/prisma'
import type { WorldStateChange } from '@/components/scene/AITransparencyPanel'

interface WorldStateSnapshot {
  npcs: Record<string, any>
  factions: Record<string, any>
  clocks: Record<string, any>
  characters: Record<string, any>
}

/**
 * Capture the current world state before AI resolution
 */
export async function captureWorldStateSnapshot(campaignId: string): Promise<WorldStateSnapshot> {
  const [npcs, factions, clocks, characters] = await Promise.all([
    prisma.nPC.findMany({ where: { campaignId } }),
    prisma.faction.findMany({ where: { campaignId } }),
    prisma.clock.findMany({ where: { campaignId } }),
    prisma.character.findMany({ where: { campaignId } })
  ])

  return {
    npcs: Object.fromEntries(npcs.map(n => [n.id, n])),
    factions: Object.fromEntries(factions.map(f => [f.id, f])),
    clocks: Object.fromEntries(clocks.map(c => [c.id, c])),
    characters: Object.fromEntries(characters.map(c => [c.id, c]))
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
  const [npcs, factions, clocks, characters] = await Promise.all([
    prisma.nPC.findMany({ where: { campaignId } }),
    prisma.faction.findMany({ where: { campaignId } }),
    prisma.clock.findMany({ where: { campaignId } }),
    prisma.character.findMany({ where: { campaignId } })
  ])

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
  for (const beforeId of Object.keys(beforeSnapshot.npcs)) {
    if (!npcs.find(n => n.id === beforeId)) {
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
 * Store world state changes in the scene for display
 */
export async function storeWorldStateChanges(
  sceneId: string,
  changes: WorldStateChange[]
): Promise<void> {
  // Store in scene consequences field
  await prisma.scene.update({
    where: { id: sceneId },
    data: {
      consequences: {
        worldStateChanges: changes
      } as any
    }
  })
}

/**
 * Retrieve world state changes for a scene
 */
export async function getWorldStateChanges(sceneId: string): Promise<WorldStateChange[]> {
  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    select: { consequences: true }
  })

  const consequences = scene?.consequences as any
  return consequences?.worldStateChanges || []
}

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
    let notificationType: string = 'AI_RESPONSE_READY'
    let priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' = 'NORMAL'

    if (change.details.includes('stat') || change.details.includes('perk')) {
      priority = 'HIGH'
    }

    await prisma.notification.create({
      data: {
        type: notificationType as any,
        title: `${character.name} has grown!`,
        message: `Your character has progressed: ${change.details}${sceneNumber ? ` (Scene ${sceneNumber})` : ''}`,
        status: 'UNREAD',
        priority,
        userId: character.userId,
        campaignId,
        actionUrl: `/campaigns/${campaignId}/characters/${characterId}`,
        metadata: {
          characterId,
          sceneNumber,
          changes: change.details
        }
      }
    })
  }
}
