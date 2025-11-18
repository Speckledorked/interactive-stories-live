// src/lib/game/stateUpdater.ts
// Apply AI GM world updates to the database
// This is where the AI's narrative decisions become persistent game state

import { prisma } from '@/lib/prisma'
import { AIGMResponse } from '@/lib/ai/client'
import { EventVisibility, ThreatLevel } from '@prisma/client'

/**
 * Apply all world updates from an AI GM response to the database
 * This is transactional - if any update fails, all are rolled back
 * 
 * @param campaignId - Campaign to update
 * @param aiResponse - AI GM's response with world_updates
 * @param currentTurnNumber - The turn number being resolved
 */
export async function applyWorldUpdates(
  campaignId: string,
  aiResponse: AIGMResponse,
  currentTurnNumber: number
): Promise<void> {
  console.log('💾 Applying world updates to database...')

  const { world_updates } = aiResponse

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Create timeline events
      if (world_updates.new_timeline_events) {
        console.log(`📜 Creating ${world_updates.new_timeline_events.length} timeline events`)
        
        for (const event of world_updates.new_timeline_events) {
          await tx.timelineEvent.create({
            data: {
              campaignId,
              turnNumber: currentTurnNumber,
              title: event.title,
              summaryPublic: event.summary_public,
              summaryGM: event.summary_gm,
              isOffscreen: event.is_offscreen,
              visibility: event.visibility.toUpperCase() as EventVisibility
            }
          })
        }
      }

      // 2. Update clocks
      if (world_updates.clock_changes) {
        console.log(`⏰ Updating ${world_updates.clock_changes.length} clocks`)
        
        for (const clockChange of world_updates.clock_changes) {
          // Try to find clock by ID first, then by name
          const clock = await tx.clock.findFirst({
            where: {
              campaignId,
              OR: [
                { id: clockChange.clock_name_or_id },
                { name: { contains: clockChange.clock_name_or_id, mode: 'insensitive' } }
              ]
            }
          })

          if (clock) {
            const newTicks = Math.max(0, Math.min(
              clock.currentTicks + clockChange.delta,
              clock.maxTicks
            ))

            await tx.clock.update({
              where: { id: clock.id },
              data: { currentTicks: newTicks }
            })

            console.log(`  ⏰ ${clock.name}: ${clock.currentTicks} → ${newTicks}`)
          } else {
            console.warn(`  ⚠️ Clock not found: ${clockChange.clock_name_or_id}`)
          }
        }
      }

      // 3. Update NPCs
      if (world_updates.npc_changes) {
        console.log(`👤 Updating ${world_updates.npc_changes.length} NPCs`)
        
        for (const npcChange of world_updates.npc_changes) {
          const npc = await tx.nPC.findFirst({
            where: {
              campaignId,
              OR: [
                { id: npcChange.npc_name_or_id },
                { name: { contains: npcChange.npc_name_or_id, mode: 'insensitive' } }
              ]
            }
          })

          if (npc) {
            const updateData: any = {}

            // Append to notes if provided
            if (npcChange.changes.notes_append) {
              updateData.notes = npc.notes + '\n\n' + npcChange.changes.notes_append
            }

            // Add/remove tags
            if (npcChange.changes.tags_add || npcChange.changes.tags_remove) {
              const currentTags = Array.isArray(npc.tags) ? npc.tags : []
              let newTags = [...currentTags]

              if (npcChange.changes.tags_add) {
                newTags = [...newTags, ...npcChange.changes.tags_add]
              }

         if (npcChange.changes.tags_remove) {
  newTags = newTags
    .filter((t): t is string => typeof t === "string")
    .filter(t => !npcChange.changes.tags_remove!.includes(t));
}


              updateData.tags = Array.from(new Set(newTags)) // Remove duplicates
            }

            if (Object.keys(updateData).length > 0) {
              await tx.nPC.update({
                where: { id: npc.id },
                data: updateData
              })

              console.log(`  👤 Updated NPC: ${npc.name}`)
            }
          } else {
            console.warn(`  ⚠️ NPC not found: ${npcChange.npc_name_or_id}`)
          }
        }
      }

      // 4. Update player characters
      if (world_updates.pc_changes) {
        console.log(`🦸 Updating ${world_updates.pc_changes.length} characters`)
        
        for (const pcChange of world_updates.pc_changes) {
          const character = await tx.character.findFirst({
            where: {
              campaignId,
              OR: [
                { id: pcChange.character_name_or_id },
                { name: { contains: pcChange.character_name_or_id, mode: 'insensitive' } }
              ]
            }
          })

          if (character) {
            const updateData: any = {}

            // Update location
            if (pcChange.changes.location) {
              updateData.currentLocation = pcChange.changes.location
            }

            // Add/remove conditions
            if (pcChange.changes.conditions_add || pcChange.changes.conditions_remove) {
              const currentConditions = Array.isArray(character.conditions) 
                ? character.conditions 
                : []
              let newConditions = [...currentConditions]

              if (pcChange.changes.conditions_add) {
                newConditions = [...newConditions, ...pcChange.changes.conditions_add]
              }

             if (pcChange.changes.conditions_remove) {
  newConditions = newConditions
    .filter((c): c is string => typeof c === "string")
    .filter(c => !pcChange.changes.conditions_remove!.includes(c));
}
              updateData.conditions = newConditions
            }

            if (Object.keys(updateData).length > 0) {
              await tx.character.update({
                where: { id: character.id },
                data: updateData
              })

              console.log(`  🦸 Updated character: ${character.name}`)
            }
          } else {
            console.warn(`  ⚠️ Character not found: ${pcChange.character_name_or_id}`)
          }
        }
      }

      // 5. Update factions
      if (world_updates.faction_changes) {
        console.log(`🏛️ Updating ${world_updates.faction_changes.length} factions`)
        
        for (const factionChange of world_updates.faction_changes) {
          const faction = await tx.faction.findFirst({
            where: {
              campaignId,
              OR: [
                { id: factionChange.faction_name_or_id },
                { name: { contains: factionChange.faction_name_or_id, mode: 'insensitive' } }
              ]
            }
          })

          if (faction) {
            const updateData: any = {}

            if (factionChange.changes.current_plan) {
              updateData.currentPlan = factionChange.changes.current_plan
            }

            if (factionChange.changes.threat_level) {
              updateData.threatLevel = factionChange.changes.threat_level as ThreatLevel
            }

            if (factionChange.changes.resources) {
              updateData.resources = factionChange.changes.resources
            }

            if (factionChange.changes.gm_notes_append) {
              updateData.gmNotes = faction.gmNotes + '\n\n' + factionChange.changes.gm_notes_append
            }

            if (Object.keys(updateData).length > 0) {
              await tx.faction.update({
                where: { id: faction.id },
                data: updateData
              })

              console.log(`  🏛️ Updated faction: ${faction.name}`)
            }
          } else {
            console.warn(`  ⚠️ Faction not found: ${factionChange.faction_name_or_id}`)
          }
        }
      }

      // 6. Store GM notes in WorldMeta if provided
      if (world_updates.notes_for_gm) {
        const worldMeta = await tx.worldMeta.findUnique({
          where: { campaignId }
        })

        if (worldMeta) {
          const currentMeta = worldMeta.otherMeta as any || {}
          const gmNotes = currentMeta.gm_notes_history || []
          
          gmNotes.push({
            turn: currentTurnNumber,
            notes: world_updates.notes_for_gm,
            timestamp: new Date().toISOString()
          })

          // Keep only last 20 notes to avoid bloat
          if (gmNotes.length > 20) {
            gmNotes.shift()
          }

          await tx.worldMeta.update({
            where: { id: worldMeta.id },
            data: {
              otherMeta: {
                ...currentMeta,
                gm_notes_history: gmNotes
              }
            }
          })

          console.log('📝 Stored GM notes')
        }
      }
    })

    console.log('✅ All world updates applied successfully')
  } catch (error) {
    console.error('❌ Failed to apply world updates:', error)
    throw new Error(`Failed to apply world updates: ${error}`)
  }
}

/**
 * Check for completed clocks and create consequence events
 * Called during world turns
 * 
 * @param campaignId - Campaign to check
 * @returns Array of completed clocks
 */
export async function checkAndResolveCompletedClocks(
  campaignId: string,
  currentTurnNumber: number
): Promise<any[]> {
  console.log('🔍 Checking for completed clocks...')

  const completedClocks = await prisma.clock.findMany({
    where: {
      campaignId,
      currentTicks: { gte: prisma.clock.fields.maxTicks }
    },
    include: {
      relatedFaction: true
    }
  })

  if (completedClocks.length === 0) {
    console.log('  No completed clocks')
    return []
  }

  console.log(`⏰ ${completedClocks.length} clock(s) completed!`)

  // Create timeline events for each completed clock
  for (const clock of completedClocks) {
    await prisma.timelineEvent.create({
      data: {
        campaignId,
        turnNumber: currentTurnNumber,
        title: `${clock.name} - Complete!`,
        summaryPublic: clock.consequence,
        summaryGM: `Clock "${clock.name}" reached ${clock.maxTicks} ticks. ${clock.gmNotes}`,
        isOffscreen: true,
        visibility: clock.isHidden ? 'GM_ONLY' : 'PUBLIC'
      }
    })

    console.log(`  ⏰ Created event for: ${clock.name}`)
  }

  return completedClocks
}

/**
 * Simple helper to log what changed
 * Useful for debugging and admin views
 */
export function summarizeWorldUpdates(aiResponse: AIGMResponse): string {
  const updates = aiResponse.world_updates
  const summary: string[] = []

  if (updates.new_timeline_events?.length) {
    summary.push(`${updates.new_timeline_events.length} new timeline events`)
  }

  if (updates.clock_changes?.length) {
    summary.push(`${updates.clock_changes.length} clock changes`)
  }

  if (updates.npc_changes?.length) {
    summary.push(`${updates.npc_changes.length} NPC updates`)
  }

  if (updates.pc_changes?.length) {
    summary.push(`${updates.pc_changes.length} character updates`)
  }

  if (updates.faction_changes?.length) {
    summary.push(`${updates.faction_changes.length} faction updates`)
  }

  if (updates.notes_for_gm) {
    summary.push('GM notes recorded')
  }

  return summary.length > 0 
    ? summary.join(', ')
    : 'No world changes'
}
