// src/lib/game/stateUpdater.ts
// Apply AI GM world updates to the database
// This is where the AI's narrative decisions become persistent game state

import { prisma } from '@/lib/prisma'
import { AIGMResponse } from '@/lib/ai/client'
import { EventVisibility } from '@prisma/client'
import {
  applyHarm,
  healHarm,
  markCondition,
  clearCondition,
  performRecoveryRoll,
  makeDeathSave,
  applyMedicalAttention,
  performHeroicSacrifice,
  isDying,
  HarmState,
  Condition,
  HarmLevel,
  PermanentInjury
} from './harm'
import { getArmorReduction } from './inventory'
import { AI_MODELS } from '@/lib/ai/models'
import { recordAICost, estimateTokenCount } from '@/lib/ai/cost-tracker'

/**
 * Apply all world updates from an AI GM response to the database
 * This is transactional - if any update fails, all are rolled back
 * 
 * @param campaignId - Campaign to update
 * @param aiResponse - AI GM's response with world_updates
 * @param currentTurnNumber - The turn number being resolved
 */
export interface AppliedWorldUpdates {
  /** NPC IDs actually resolved/created while applying npc_changes — the scene's real entity linkage. */
  involvedNpcIds: string[]
  /** Faction IDs actually resolved/created while applying faction_changes. */
  involvedFactionIds: string[]
}

export async function applyWorldUpdates(
  campaignId: string,
  aiResponse: AIGMResponse,
  currentTurnNumber: number
): Promise<AppliedWorldUpdates> {
  console.log('💾 Applying world updates to database...')

  const { world_updates } = aiResponse

  // Populated as NPC/Faction records are resolved below — this is the only
  // reliable record of which entities this scene actually touched (npc_changes/
  // faction_changes reference entities by free-text npc_name_or_id/faction_name_or_id,
  // resolved to real IDs here and nowhere else).
  const involvedNpcIds = new Set<string>()
  const involvedFactionIds = new Set<string>()

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
            involvedNpcIds.add(npc.id)
            const updateData: any = {}

            // Append to GM notes if provided
            if (npcChange.changes.notes_append) {
              updateData.gmNotes = (npc.gmNotes || '') + '\n\n' + npcChange.changes.notes_append
            }

            // Update description if AI provided one and NPC has none yet
            if (npcChange.changes.description && !npc.description) {
              updateData.description = npcChange.changes.description
            }

            // New/updated goal — a fresh goal starts its progress over,
            // regardless of what was left on the previous one.
            if (npcChange.changes.goals) {
              updateData.goals = npcChange.changes.goals
              updateData.goalProgress = 0
            }

            // Note: tags_add and tags_remove are not supported in the current schema
            // NPCs don't have a tags field

            if (Object.keys(updateData).length > 0) {
              await tx.nPC.update({
                where: { id: npc.id },
                data: updateData
              })

              console.log(`  👤 Updated NPC: ${npc.name}`)
            }
          } else if (npcChange.is_new || npcChange.changes.description) {
            // Auto-create a stub NPC when the AI introduces a new character mid-scene
            const newNPC = await tx.nPC.create({
              data: {
                campaignId,
                name: npcChange.npc_name_or_id,
                description: npcChange.changes.description || null,
                gmNotes: npcChange.changes.notes_append || null,
                goals: npcChange.changes.goals || null,
                importance: 1,
                isAlive: true
              }
            })
            involvedNpcIds.add(newNPC.id)
            console.log(`  👤 Created new NPC: ${newNPC.name}`)
          } else {
            console.warn(`  ⚠️ NPC not found and no stub info provided: ${npcChange.npc_name_or_id}`)
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

            // Process harm and conditions
            const previousHarm = (character.harm as number) || 0
            let currentHarm = previousHarm
            let currentConditions: Condition[] = (character.conditions as any)?.conditions || []
            let permanentInjuries: PermanentInjury[] = (character.conditions as any)?.permanentInjuries || []
            let deathSaves: number = (character.conditions as any)?.deathSaves || 0
            let newIsAlive: boolean | undefined
            let harmMessages: string[] = []

            // Apply harm damage (armor mitigates incoming damage)
            if (pcChange.changes.harm_damage && pcChange.changes.harm_damage > 0) {
              const armorName = (character.equipment as any)?.armor || ''
              const armorReduction = getArmorReduction(armorName)
              const harmResult = applyHarm(
                currentHarm as HarmLevel,
                pcChange.changes.harm_damage,
                armorReduction
              )
              currentHarm = harmResult.newHarm
              harmMessages.push(harmResult.message)

              // Auto-add conditions from harm
              for (const autoCondition of harmResult.autoConditions) {
                const condResult = markCondition(currentConditions, autoCondition)
                currentConditions = condResult.updatedConditions
              }
            }

            // Apply harm healing
            if (pcChange.changes.harm_healing && pcChange.changes.harm_healing > 0) {
              const healResult = healHarm(
                currentHarm as HarmLevel,
                pcChange.changes.harm_healing
              )
              currentHarm = healResult.newHarm
              harmMessages.push(healResult.message)
            }

            // Add conditions
            if (pcChange.changes.conditions_add && pcChange.changes.conditions_add.length > 0) {
              for (const conditionData of pcChange.changes.conditions_add) {
                const newCondition: Condition = {
                  id: conditionData.id || `condition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                  name: conditionData.name,
                  category: conditionData.category,
                  description: conditionData.description,
                  mechanicalEffect: conditionData.mechanicalEffect,
                  appliedAt: currentTurnNumber
                }
                const condResult = markCondition(currentConditions, newCondition)
                currentConditions = condResult.updatedConditions
                harmMessages.push(condResult.message)
              }
            }

            // Remove conditions
            if (pcChange.changes.conditions_remove && pcChange.changes.conditions_remove.length > 0) {
              for (const conditionIdOrName of pcChange.changes.conditions_remove) {
                // Try to find by ID first, then by name
                const conditionToRemove = currentConditions.find(c =>
                  c.id === conditionIdOrName ||
                  c.name.toLowerCase() === conditionIdOrName.toLowerCase()
                )

                if (conditionToRemove) {
                  const clearResult = clearCondition(currentConditions, conditionToRemove.id)
                  currentConditions = clearResult.updatedConditions
                  harmMessages.push(clearResult.message)
                }
              }
            }

            // Taken Out for the first time this turn (was under 6, now at 6):
            // resolve the outcome server-side, the same way a GM would roll
            // behind the screen — stabilized, a lasting injury, captured, or
            // critical. Not something the AI decides.
            if (previousHarm < 6 && currentHarm === 6) {
              const roll = (Math.floor(Math.random() * 6) + 1) + (Math.floor(Math.random() * 6) + 1)
              const recovery = performRecoveryRoll(roll, harmMessages.join('; ') || 'Taken Out', currentTurnNumber)
              currentHarm = recovery.newHarm

              // The generic "Taken Out" condition from applyHarm's auto-add is
              // superseded by whichever specific outcome the recovery roll gives.
              currentConditions = currentConditions.filter(c => c.name !== 'Taken Out')

              if (recovery.outcome === 'permanent_injury' && recovery.permanentInjury) {
                permanentInjuries = [...permanentInjuries, recovery.permanentInjury]
                currentConditions = markCondition(currentConditions, {
                  id: recovery.permanentInjury.id,
                  name: recovery.permanentInjury.name,
                  category: 'Physical',
                  description: recovery.permanentInjury.description,
                  mechanicalEffect: recovery.permanentInjury.mechanicalEffect,
                  appliedAt: currentTurnNumber
                }).updatedConditions
              } else if (recovery.outcome === 'captured') {
                currentConditions = markCondition(currentConditions, {
                  id: `captured_${Date.now()}`,
                  name: 'Captured',
                  category: 'Physical',
                  description: 'Taken prisoner while unconscious.',
                  mechanicalEffect: 'Cannot act until freed',
                  appliedAt: currentTurnNumber
                }).updatedConditions
              } else if (recovery.outcome === 'dead') {
                // performRecoveryRoll's worst outcome is critical, not final —
                // it still takes intervention or repeated death saves.
                deathSaves = 2
                currentConditions = markCondition(currentConditions, {
                  id: `dying_${Date.now()}`,
                  name: 'Critically Dying',
                  category: 'Physical',
                  description: 'Unconscious and fading fast. Someone must intervene.',
                  mechanicalEffect: 'Cannot act',
                  appliedAt: currentTurnNumber
                }).updatedConditions
              }

              harmMessages.push(recovery.message)
            }

            // Skill-scaled treatment, usable any time a character is hurt.
            // applyMedicalAttention itself refuses to touch someone still at
            // harm 6 (unconscious/dying) — they need to be stabilized via a
            // death save first, same as the harm.ts module's own design.
            if (pcChange.changes.medical_attention) {
              const { skill, has_supplies } = pcChange.changes.medical_attention
              const treatment = applyMedicalAttention(currentHarm as HarmLevel, skill, has_supplies)
              currentHarm = treatment.newHarm
              harmMessages.push(treatment.message)
              if (treatment.success && currentHarm < 6) {
                currentConditions = currentConditions.filter(
                  c => !['Taken Out', 'Captured', 'Critically Dying', 'Stabilized'].includes(c.name)
                )
                deathSaves = 0
              }
            }

            // Already critically dying: apply whatever the AI narrated this turn.
            const wasDying = isDying(currentHarm as HarmLevel, currentConditions)
            if (wasDying && pcChange.changes.death_save_result) {
              const save = makeDeathSave(deathSaves, pcChange.changes.death_save_result === 'success')
              deathSaves = save.newDeathSaves
              harmMessages.push(save.message)

              if (save.status === 'stable') {
                currentConditions = currentConditions.filter(c => c.name !== 'Critically Dying')
                currentConditions = markCondition(currentConditions, {
                  id: `stabilized_${Date.now()}`,
                  name: 'Stabilized',
                  category: 'Physical',
                  description: 'No longer dying, but still critically injured.',
                  mechanicalEffect: 'Cannot act until harm reduced below 6',
                  appliedAt: currentTurnNumber
                }).updatedConditions
              } else if (save.status === 'dead') {
                newIsAlive = false
                currentConditions = currentConditions.filter(c => c.name !== 'Critically Dying')
                currentConditions = markCondition(currentConditions, {
                  id: `deceased_${Date.now()}`,
                  name: 'Deceased',
                  category: 'Physical',
                  description: 'Died from their wounds.',
                  mechanicalEffect: 'Cannot act',
                  appliedAt: currentTurnNumber
                }).updatedConditions
              }
            }

            if (pcChange.changes.heroic_sacrifice) {
              const { circumstances, effect } = pcChange.changes.heroic_sacrifice
              const sacrifice = performHeroicSacrifice(character.id, character.name, circumstances, effect, currentTurnNumber)
              newIsAlive = false
              currentConditions = markCondition(currentConditions, {
                id: `sacrifice_${Date.now()}`,
                name: 'Fallen',
                category: 'Physical',
                description: sacrifice.legacy || `${character.name} gave their life.`,
                mechanicalEffect: 'Cannot act',
                appliedAt: currentTurnNumber
              }).updatedConditions
              harmMessages.push(sacrifice.legacy || `${character.name} makes the ultimate sacrifice.`)
            }

            // Update harm and conditions if changed
            if (harmMessages.length > 0) {
              updateData.harm = currentHarm
              updateData.conditions = {
                conditions: currentConditions,
                permanentInjuries,
                deathSaves
              }
              if (newIsAlive !== undefined) {
                updateData.isAlive = newIsAlive
              }
              console.log(`  💔 ${character.name}: ${harmMessages.join(', ')}`)
            }

            // Phase 14: Process relationship changes
            if (pcChange.changes.relationship_changes && pcChange.changes.relationship_changes.length > 0) {
              const currentRelationships: any = (character.relationships as any) || {}

              for (const relChange of pcChange.changes.relationship_changes) {
                const entityId = relChange.entity_id
                const currentRel = currentRelationships[entityId] || {
                  trust: 0,
                  tension: 0,
                  respect: 0,
                  fear: 0
                }

                // Apply deltas and clamp between -100 and 100
                const clamp = (value: number) => Math.max(-100, Math.min(100, value))

                currentRelationships[entityId] = {
                  trust: relChange.trust_delta !== undefined ? clamp(currentRel.trust + relChange.trust_delta) : currentRel.trust,
                  tension: relChange.tension_delta !== undefined ? clamp(currentRel.tension + relChange.tension_delta) : currentRel.tension,
                  respect: relChange.respect_delta !== undefined ? clamp(currentRel.respect + relChange.respect_delta) : currentRel.respect,
                  fear: relChange.fear_delta !== undefined ? clamp(currentRel.fear + relChange.fear_delta) : currentRel.fear
                }

                console.log(`  🤝 ${character.name} → ${relChange.entity_name}: ${relChange.reason}`)
              }

              updateData.relationships = currentRelationships
            }

            // Phase 14: Process consequence changes
            if (pcChange.changes.consequences_add || pcChange.changes.consequences_remove) {
              const currentConsequences: any = (character.consequences as any) || {
                promises: [],
                debts: [],
                enemies: [],
                longTermThreats: []
              }

              // Add new consequences
              if (pcChange.changes.consequences_add) {
                for (const newConseq of pcChange.changes.consequences_add) {
                  const typeKey = newConseq.type === 'longTermThreat' ? 'longTermThreats' : newConseq.type + 's'
                  if (!currentConsequences[typeKey]) {
                    currentConsequences[typeKey] = []
                  }
                  currentConsequences[typeKey].push(newConseq.description)
                  console.log(`  ⚠️ ${character.name} gained ${newConseq.type}: ${newConseq.description}`)
                }
              }

              // Remove consequences
              if (pcChange.changes.consequences_remove) {
                for (const toRemove of pcChange.changes.consequences_remove) {
                  // Search all consequence arrays for matching description
                  for (const key of Object.keys(currentConsequences)) {
                    if (Array.isArray(currentConsequences[key])) {
                      currentConsequences[key] = currentConsequences[key].filter(
                        (item: string) => !item.toLowerCase().includes(toRemove.toLowerCase())
                      )
                    }
                  }
                  console.log(`  ✅ ${character.name} resolved consequence: ${toRemove}`)
                }
              }

              updateData.consequences = currentConsequences
            }

            // Process appearance changes
            if (pcChange.changes.appearance_changes) {
              const appearanceChange = pcChange.changes.appearance_changes
              if (appearanceChange.append) {
                const currentAppearance = character.appearance || ''
                updateData.appearance = currentAppearance
                  ? `${currentAppearance} ${appearanceChange.description}`
                  : appearanceChange.description
              } else {
                updateData.appearance = appearanceChange.description
              }
              console.log(`  👁️ ${character.name} appearance changed: ${appearanceChange.description}`)
            }

            // Process personality changes
            if (pcChange.changes.personality_changes) {
              const personalityChange = pcChange.changes.personality_changes
              if (personalityChange.append) {
                const currentPersonality = character.personality || ''
                updateData.personality = currentPersonality
                  ? `${currentPersonality} ${personalityChange.description}`
                  : personalityChange.description
              } else {
                updateData.personality = personalityChange.description
              }
              console.log(`  🧠 ${character.name} personality changed: ${personalityChange.description}`)
            }

            // Process equipment changes
            if (pcChange.changes.equipment_changes) {
              const currentEquipment: any = (character.equipment as any) || {}
              const equipChange = pcChange.changes.equipment_changes

              if (equipChange.weapon) {
                if (equipChange.weapon.action === 'add' || equipChange.weapon.action === 'replace') {
                  currentEquipment.weapon = equipChange.weapon.value
                  console.log(`  ⚔️ ${character.name} equipped weapon: ${equipChange.weapon.value}`)
                } else if (equipChange.weapon.action === 'remove') {
                  console.log(`  ⚔️ ${character.name} lost weapon: ${currentEquipment.weapon || equipChange.weapon.value}`)
                  currentEquipment.weapon = ''
                }
              }

              if (equipChange.armor) {
                if (equipChange.armor.action === 'add' || equipChange.armor.action === 'replace') {
                  currentEquipment.armor = equipChange.armor.value
                  console.log(`  🛡️ ${character.name} equipped armor: ${equipChange.armor.value}`)
                } else if (equipChange.armor.action === 'remove') {
                  console.log(`  🛡️ ${character.name} lost armor: ${currentEquipment.armor || equipChange.armor.value}`)
                  currentEquipment.armor = ''
                }
              }

              if (equipChange.misc) {
                if (equipChange.misc.action === 'add' || equipChange.misc.action === 'replace') {
                  currentEquipment.misc = equipChange.misc.value
                  console.log(`  🎒 ${character.name} equipped misc: ${equipChange.misc.value}`)
                } else if (equipChange.misc.action === 'remove') {
                  console.log(`  🎒 ${character.name} lost misc: ${currentEquipment.misc || equipChange.misc.value}`)
                  currentEquipment.misc = ''
                }
              }

              updateData.equipment = currentEquipment
            }

            // Process inventory changes
            if (pcChange.changes.inventory_changes) {
              const currentInventory: any = (character.inventory as any) || { items: [], slots: 10 }
              const invChange = pcChange.changes.inventory_changes

              // Ensure items array exists
              if (!currentInventory.items) {
                currentInventory.items = []
              }

              // Add items
              if (invChange.items_add) {
                for (const newItem of invChange.items_add) {
                  // Check if item already exists, if so increase quantity
                  const existingItem = currentInventory.items.find((item: any) => item.id === newItem.id)
                  if (existingItem) {
                    existingItem.quantity += newItem.quantity
                    console.log(`  📦 ${character.name} gained ${newItem.quantity}x ${newItem.name} (now ${existingItem.quantity})`)
                  } else {
                    currentInventory.items.push(newItem)
                    console.log(`  📦 ${character.name} gained ${newItem.quantity}x ${newItem.name}`)
                  }
                }
              }

              // Remove items
              if (invChange.items_remove) {
                for (const itemIdOrName of invChange.items_remove) {
                  const indexToRemove = currentInventory.items.findIndex((item: any) =>
                    item.id === itemIdOrName || item.name.toLowerCase() === itemIdOrName.toLowerCase()
                  )
                  if (indexToRemove !== -1) {
                    const removedItem = currentInventory.items[indexToRemove]
                    currentInventory.items.splice(indexToRemove, 1)
                    console.log(`  📦 ${character.name} lost ${removedItem.name}`)
                  }
                }
              }

              // Modify item quantities
              if (invChange.items_modify) {
                for (const modify of invChange.items_modify) {
                  const item = currentInventory.items.find((item: any) => item.id === modify.id)
                  if (item) {
                    item.quantity += modify.quantity_delta
                    console.log(`  📦 ${character.name} ${modify.quantity_delta > 0 ? 'gained' : 'used'} ${Math.abs(modify.quantity_delta)}x ${item.name} (now ${item.quantity})`)

                    // Remove item if quantity reaches 0 or below
                    if (item.quantity <= 0) {
                      const index = currentInventory.items.findIndex((i: any) => i.id === modify.id)
                      currentInventory.items.splice(index, 1)
                      console.log(`  📦 ${character.name} ran out of ${item.name}`)
                    }
                  }
                }
              }

              // Adjust slots
              if (invChange.slots_delta) {
                currentInventory.slots = Math.max(0, (currentInventory.slots || 10) + invChange.slots_delta)
                console.log(`  🎒 ${character.name} inventory slots: ${invChange.slots_delta > 0 ? '+' : ''}${invChange.slots_delta} (now ${currentInventory.slots})`)
              }

              updateData.inventory = currentInventory
            }

            // Process resource changes
            if (pcChange.changes.resource_changes) {
              const currentResources: any = (character.resources as any) || { gold: 0, contacts: [], reputation: {} }
              const resChange = pcChange.changes.resource_changes

              // Gold changes
              if (resChange.gold_delta !== undefined) {
                currentResources.gold = Math.max(0, (currentResources.gold || 0) + resChange.gold_delta)
                console.log(`  💰 ${character.name} ${resChange.gold_delta > 0 ? 'gained' : 'spent'} ${Math.abs(resChange.gold_delta)} gold (now ${currentResources.gold})`)
              }

              // Contact changes
              if (resChange.contacts_add) {
                if (!currentResources.contacts) currentResources.contacts = []
                for (const contact of resChange.contacts_add) {
                  if (!currentResources.contacts.includes(contact)) {
                    currentResources.contacts.push(contact)
                    console.log(`  🤝 ${character.name} gained contact: ${contact}`)
                  }
                }
              }

              if (resChange.contacts_remove) {
                if (currentResources.contacts) {
                  for (const contact of resChange.contacts_remove) {
                    currentResources.contacts = currentResources.contacts.filter((c: string) => c !== contact)
                    console.log(`  🤝 ${character.name} lost contact: ${contact}`)
                  }
                }
              }

              // Reputation changes
              if (resChange.reputation_changes) {
                if (!currentResources.reputation) currentResources.reputation = {}
                for (const repChange of resChange.reputation_changes) {
                  const current = currentResources.reputation[repChange.faction] || 0
                  currentResources.reputation[repChange.faction] = current + repChange.delta
                  console.log(`  ⭐ ${character.name} reputation with ${repChange.faction}: ${repChange.delta > 0 ? '+' : ''}${repChange.delta} (now ${currentResources.reputation[repChange.faction]})`)
                }
              }

              updateData.resources = currentResources
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

      // 5. Process organic character advancement
      if (world_updates.organic_advancement) {
        console.log(`📈 Processing ${world_updates.organic_advancement.length} character advancement(s)`)

        for (const advancement of world_updates.organic_advancement) {
          const character = await tx.character.findUnique({
            where: { id: advancement.character_id }
          })

          if (character) {
            const updateData: any = {}

            // Process stat increases
            if (advancement.stat_increases && advancement.stat_increases.length > 0) {
              const currentStats: any = (character.stats as any) || {}

              for (const statIncrease of advancement.stat_increases) {
                const currentValue = currentStats[statIncrease.stat_key] || 0
                const newValue = Math.min(3, currentValue + statIncrease.delta) // Cap at +3
                currentStats[statIncrease.stat_key] = newValue
                console.log(`  📊 ${character.name} ${statIncrease.stat_key}: ${currentValue} → ${newValue} (${statIncrease.reason})`)
              }

              updateData.stats = currentStats
            }

            // Process new perks
            if (advancement.new_perks && advancement.new_perks.length > 0) {
              const currentPerks: any[] = (character.perks as any) || []

              for (const newPerk of advancement.new_perks) {
                // Check if perk already exists
                const exists = currentPerks.some((p: any) => p.id === newPerk.id)
                if (!exists) {
                  currentPerks.push(newPerk)
                  console.log(`  ✨ ${character.name} gained perk: ${newPerk.name}`)
                }
              }

              updateData.perks = currentPerks
            }

            // Process new moves
            if (advancement.new_moves && advancement.new_moves.length > 0) {
              const currentMoves: string[] = (character.moves as any) || []

              for (const newMove of advancement.new_moves) {
                if (!currentMoves.includes(newMove)) {
                  currentMoves.push(newMove)
                  console.log(`  🎯 ${character.name} learned move: ${newMove}`)
                }
              }

              updateData.moves = currentMoves
            }

            if (Object.keys(updateData).length > 0) {
              await tx.character.update({
                where: { id: character.id },
                data: updateData
              })

              console.log(`  📈 Advanced character: ${character.name}`)
            }
          } else {
            console.warn(`  ⚠️ Character not found for advancement: ${advancement.character_id}`)
          }
        }
      }

      // 6. Update factions
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
            involvedFactionIds.add(faction.id)
            const updateData: any = {}

            if (factionChange.changes.current_plan) {
              updateData.currentPlan = factionChange.changes.current_plan
            }

            if (factionChange.changes.threat_level) {
              // Map threat level string to number
              const threatLevelMap: Record<string, number> = {
                'LOW': 1,
                'MEDIUM': 2,
                'HIGH': 3,
                'EXTREME': 4
              }
              const level = factionChange.changes.threat_level.toUpperCase()
              updateData.threatLevel = threatLevelMap[level] || faction.threatLevel
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
          } else if (factionChange.is_new || factionChange.changes.description) {
            // Auto-create a stub faction when the AI introduces a new group mid-campaign
            const threatLevelMap: Record<string, number> = {
              'LOW': 1, 'MEDIUM': 2, 'HIGH': 3, 'EXTREME': 4
            }
            const initialThreat = factionChange.changes.threat_level
              ? (threatLevelMap[factionChange.changes.threat_level.toUpperCase()] || 1)
              : 1
            const newFaction = await tx.faction.create({
              data: {
                campaignId,
                name: factionChange.faction_name_or_id,
                description: factionChange.changes.description || '',
                goals: factionChange.changes.goals || '',
                currentPlan: factionChange.changes.current_plan || '',
                threatLevel: initialThreat,
                gmNotes: factionChange.changes.gm_notes_append || ''
              }
            })
            involvedFactionIds.add(newFaction.id)
            console.log(`  🏛️ Created new faction: ${newFaction.name}`)
          } else {
            console.warn(`  ⚠️ Faction not found and no stub info provided: ${factionChange.faction_name_or_id}`)
          }
        }
      }

      // 7. Upsert locations
      if (world_updates.location_changes) {
        console.log(`📍 Syncing ${world_updates.location_changes.length} location(s)`)

        for (const locChange of world_updates.location_changes) {
          const existing = await tx.location.findUnique({
            where: { campaignId_name: { campaignId, name: locChange.name } }
          })

          if (existing) {
            const updateData: any = {}
            if (locChange.description && !existing.description) {
              updateData.description = locChange.description
            }
            if (locChange.location_type && !existing.locationType) {
              updateData.locationType = locChange.location_type
            }
            if (locChange.gm_notes_append) {
              updateData.gmNotes = (existing.gmNotes || '') + '\n\n' + locChange.gm_notes_append
            }
            if (Object.keys(updateData).length > 0) {
              await tx.location.update({
                where: { id: existing.id },
                data: updateData
              })
              console.log(`  📍 Updated location: ${locChange.name}`)
            }
          } else {
            await tx.location.create({
              data: {
                campaignId,
                name: locChange.name,
                description: locChange.description || null,
                locationType: locChange.location_type || null,
                gmNotes: locChange.gm_notes_append || null,
                isDiscovered: true
              }
            })
            console.log(`  📍 Created location: ${locChange.name}`)
          }
        }
      }

      // 7b. Auto-register locations from character movement
      if (world_updates.pc_changes) {
        for (const pcChange of world_updates.pc_changes) {
          if (pcChange.changes.location) {
            const locationName = pcChange.changes.location
            try {
              await tx.location.upsert({
                where: { campaignId_name: { campaignId, name: locationName } },
                create: {
                  campaignId,
                  name: locationName,
                  isDiscovered: true
                },
                update: {} // Already exists, no changes needed
              })
            } catch {
              // Ignore if upsert fails (e.g., concurrent write) — non-critical
            }
          }
        }
      }

      // 8. Store GM notes in WorldMeta if provided
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

    return {
      involvedNpcIds: [...involvedNpcIds],
      involvedFactionIds: [...involvedFactionIds]
    }
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

/**
 * Enrich stub factions auto-created mid-campaign with no description.
 * Mirror of enrichStubNPCs — same pattern, same non-critical fire-and-forget usage.
 */
export async function enrichStubFactions(
  campaignId: string,
  sceneText: string
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return

  const cutoff = new Date(Date.now() - 2 * 60 * 1000)
  const stubs = await prisma.faction.findMany({
    where: {
      campaignId,
      description: '',
      createdAt: { gte: cutoff }
    },
    select: { id: true, name: true }
  })

  if (stubs.length === 0) return

  console.log(`🪄 Enriching ${stubs.length} stub faction(s): ${stubs.map(f => f.name).join(', ')}`)

  const nameList = stubs.map(f => `- ${f.name}`).join('\n')
  const prompt = `You are a TTRPG game master. The following scene just resolved:\n\n${sceneText}\n\nThese factions or groups were introduced for the first time:\n${nameList}\n\nFor each faction, write a SHORT 1-2 sentence description (what they are, their role or agenda) based on context from the scene. Invent something consistent with the fiction if they aren't explicitly described.\n\nRespond with valid JSON:\n{"factions": [{"name": "...", "description": "...", "goals": "..."}]}`

  const startTime = Date.now()
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: AI_MODELS.EFFICIENT,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 400,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      console.warn('⚠️ Faction enrichment API call failed:', response.status)
      return
    }

    const data = await response.json()
    const rawContent = data.choices[0].message.content
    const parsed = JSON.parse(rawContent) as {
      factions: Array<{ name: string; description: string; goals?: string }>
    }

    const usage = data.usage || {}
    await recordAICost({
      campaignId,
      model: AI_MODELS.EFFICIENT,
      requestType: 'faction_enrichment',
      inputTokens: usage.prompt_tokens || estimateTokenCount(prompt),
      outputTokens: usage.completion_tokens || estimateTokenCount(rawContent),
      responseTimeMs: Date.now() - startTime,
      success: true
    }).catch(console.error)

    for (const enriched of parsed.factions) {
      const stub = stubs.find(f => f.name.toLowerCase() === enriched.name.toLowerCase())
      if (stub && enriched.description) {
        await prisma.faction.update({
          where: { id: stub.id },
          data: {
            description: enriched.description,
            ...(enriched.goals ? { goals: enriched.goals } : {})
          }
        })
        console.log(`  ✅ Enriched faction: ${stub.name}`)
      }
    }
  } catch (err) {
    console.warn('⚠️ Faction enrichment failed (non-critical):', err)
  }
}

/**
 * Enrich stub NPCs that were auto-created mid-scene with no description.
 *
 * After `applyWorldUpdates` commits, any NPC introduced by the AI without
 * a description exists as a bare name in the DB.  This function makes a
 * single lightweight AI call to flesh them out based on the resolved scene
 * text, then persists the result.
 *
 * Silently skips if OpenAI is unconfigured or returns an error — it is
 * intentionally non-critical.
 */
export async function enrichStubNPCs(
  campaignId: string,
  sceneText: string
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return

  // Find NPCs created in the last 2 minutes with no description
  const cutoff = new Date(Date.now() - 2 * 60 * 1000)
  const stubs = await prisma.nPC.findMany({
    where: {
      campaignId,
      description: null,
      createdAt: { gte: cutoff }
    },
    select: { id: true, name: true }
  })

  if (stubs.length === 0) return

  console.log(`🪄 Enriching ${stubs.length} stub NPC(s): ${stubs.map(n => n.name).join(', ')}`)

  const nameList = stubs.map(n => `- ${n.name}`).join('\n')
  const prompt = `You are a TTRPG game master. The following scene just resolved:\n\n${sceneText}\n\nThese NPCs were introduced for the first time:\n${nameList}\n\nFor each NPC, write a SHORT 1-2 sentence description (appearance, role, or personality) based on how they appear in the scene. If the scene doesn't mention them explicitly, invent something consistent with the fiction.\n\nRespond with valid JSON:\n{"npcs": [{"name": "...", "description": "..."}]}`

  const startTime = Date.now()
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: AI_MODELS.EFFICIENT,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 400,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      console.warn('⚠️ NPC enrichment API call failed:', response.status)
      return
    }

    const data = await response.json()
    const rawContent = data.choices[0].message.content
    const parsed = JSON.parse(rawContent) as {
      npcs: Array<{ name: string; description: string }>
    }

    const usage = data.usage || {}
    await recordAICost({
      campaignId,
      model: AI_MODELS.EFFICIENT,
      requestType: 'npc_enrichment',
      inputTokens: usage.prompt_tokens || estimateTokenCount(prompt),
      outputTokens: usage.completion_tokens || estimateTokenCount(rawContent),
      responseTimeMs: Date.now() - startTime,
      success: true
    }).catch(console.error)

    for (const enriched of parsed.npcs) {
      const stub = stubs.find(s => s.name.toLowerCase() === enriched.name.toLowerCase())
      if (stub && enriched.description) {
        await prisma.nPC.update({
          where: { id: stub.id },
          data: { description: enriched.description }
        })
        console.log(`  ✅ Enriched NPC: ${stub.name}`)
      }
    }
  } catch (err) {
    console.warn('⚠️ NPC enrichment failed (non-critical):', err)
  }
}
