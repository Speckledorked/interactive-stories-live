// src/lib/game/worldUpdaters/characters.ts
// Domain applier for world_updates.pc_changes — by far the largest and
// most interdependent domain (harm/conditions, relationships, consequences,
// appearance/personality, equipment, inventory, resources, and delegation
// to the debt/standing/capability writers). Kept as one function rather
// than further split into pure sub-appliers: harm/condition state threads
// through several sequential sub-steps (an inventory-triggered heal in the
// same pass must still land in the same updateData the earlier
// harm-damage step started), and splitting that thread across files would
// risk a subtle ordering bug for no real testability gain — the whole
// thing is still directly unit-tested as one function. See README Known
// Bugs P1 (stateUpdater decomposition, #4/#41).

import { Prisma, Character } from '@prisma/client'
import type { WorldUpdates } from '@/lib/ai/schema'
import { resolveEntityByNameOrId } from '../entityResolution'
import { resolveOrCreateLocationId } from './locations'
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
  Condition,
  HarmLevel,
  PermanentInjury
} from '../harm'
import { resolveArmorValue, resolveConsumableHeal } from '../inventory'
import { applyCapabilityChanges } from '../capabilities'
import { applyDebtChanges } from '../debts'
import { applyStandingChanges } from '../standing'
import { clampGoldDelta } from '../economy'
import {
  applyCorruptionMarks,
  corruptionStage,
  CONSUMED_CONDITION_NAME,
  CorruptionTheme
} from '../corruption'

type Db = Prisma.TransactionClient
export type PcChange = NonNullable<WorldUpdates['pc_changes']>[number]

/**
 * Caller passes a memoized getter so the corruption-theme lookup — shared
 * with bargain_offers' handling — happens at most once per batch, and
 * only if actually needed.
 */
export async function applyCharacterChanges(
  tx: Db,
  campaignId: string,
  currentTurnNumber: number,
  pcChanges: PcChange[],
  charactersForResolution: Character[],
  getCorruptionTheme: () => Promise<CorruptionTheme | null>,
  sceneOrigin: boolean
): Promise<void> {
  console.log(`🦸 Updating ${pcChanges.length} characters`)

  for (const pcChange of pcChanges) {
    const pcResolution = resolveEntityByNameOrId(charactersForResolution, pcChange.character_name_or_id)
    const character = pcResolution.kind === 'found' ? pcResolution.entity : null
    if (pcResolution.kind === 'ambiguous') {
      console.warn(`  ⚠️ Ambiguous character name "${pcChange.character_name_or_id}" — matches ${pcResolution.candidates.map(c => c.name).join(', ')}, skipping rather than guessing`)
    }

    if (!character) {
      if (pcResolution.kind === 'not_found') {
        console.warn(`  ⚠️ Character not found: ${pcChange.character_name_or_id}`)
      }
      continue
    }

    const updateData: any = {}

    // Update location. Also resolves/creates the matching Location row and
    // links it via locationId — the same auto-register-on-movement
    // behavior a separate later pass used to do, now done inline since we
    // need the id anyway (see README Known Bugs P1 — Location stored as
    // free text, not an FK).
    if (pcChange.changes.location) {
      updateData.currentLocation = pcChange.changes.location
      updateData.locationId = await resolveOrCreateLocationId(tx, campaignId, pcChange.changes.location, sceneOrigin)
    }

    // Process harm and conditions
    const previousHarm = (character.harm as number) || 0
    let currentHarm = previousHarm
    let currentConditions: Condition[] = (character.conditions as any)?.conditions || []
    let permanentInjuries: PermanentInjury[] = (character.conditions as any)?.permanentInjuries || []
    let deathSaves: number = (character.conditions as any)?.deathSaves || 0
    let newIsAlive: boolean | undefined
    let harmMessages: string[] = []

    // Apply harm damage (armor mitigates incoming damage) — prefers a
    // structured armorValue on the matching inventory item over guessing
    // from the equipped name string (see resolveArmorValue).
    if (pcChange.changes.harm_damage && pcChange.changes.harm_damage > 0) {
      const armorName = (character.equipment as any)?.armor || ''
      const armorReduction = resolveArmorValue(character.inventory as any, armorName)
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

    // Corruption marks — only when this campaign actually has a
    // corruption theme (a universe without one ignores the field
    // entirely). Clamped to one mark per scene, never decreases;
    // reaching the cap adds the Consumed condition (see corruption.ts).
    if (pcChange.changes.corruption_change) {
      const corruptionTheme = await getCorruptionTheme()
      if (corruptionTheme) {
        const marks = Number(pcChange.changes.corruption_change.marks) || 0
        const result = applyCorruptionMarks(character.corruption, marks)
        if (result.applied > 0) {
          updateData.corruption = result.newValue
          const stage = corruptionStage(corruptionTheme, result.newValue)
          harmMessages.push(`${corruptionTheme.name} deepens${stage ? `: ${stage}` : ''} (${pcChange.changes.corruption_change.reason || 'no reason given'})`)
          if (result.reachedMax) {
            currentConditions = markCondition(currentConditions, {
              id: `consumed_${Date.now()}`,
              name: CONSUMED_CONDITION_NAME,
              category: 'Special',
              description: `${corruptionTheme.name} has taken all there was to take. This character is slipping beyond the player's control.`,
              mechanicalEffect: 'The final stage of corruption — irreversible',
              appliedAt: currentTurnNumber
            }).updatedConditions
          }
        }
      }
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
      const currentInventory: any = (character.inventory as any) || { items: [] }
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

            // A consumed item's 'heal' effect is enforced here,
            // deterministically — not left to the AI to separately
            // remember via harm_healing. See resolveConsumableHeal's
            // doc comment in lib/game/inventory.ts.
            const healAmount = resolveConsumableHeal(removedItem)
            if (healAmount > 0) {
              const healResult = healHarm(currentHarm as HarmLevel, healAmount)
              currentHarm = healResult.newHarm
              harmMessages.push(`${character.name} uses ${removedItem.name}: ${healResult.message}`)
              updateData.harm = currentHarm
              updateData.conditions = { conditions: currentConditions, permanentInjuries, deathSaves }
            }
          }
        }
      }

      // Modify item quantities
      if (invChange.items_modify) {
        for (const modify of invChange.items_modify) {
          const item = currentInventory.items.find((item: any) => item.id === modify.id)
          if (item) {
            // A negative delta is "used" — apply as many units' worth of
            // 'heal' effect as were actually consumed (e.g. drinking 2
            // potions from a stack at once), before quantity drops below.
            if (modify.quantity_delta < 0) {
              const healAmount = resolveConsumableHeal(item, Math.abs(modify.quantity_delta))
              if (healAmount > 0) {
                const healResult = healHarm(currentHarm as HarmLevel, healAmount)
                currentHarm = healResult.newHarm
                harmMessages.push(`${character.name} uses ${Math.abs(modify.quantity_delta)}x ${item.name}: ${healResult.message}`)
                updateData.harm = currentHarm
                updateData.conditions = { conditions: currentConditions, permanentInjuries, deathSaves }
              }
            }

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

      updateData.inventory = currentInventory
    }

    // Process resource changes
    if (pcChange.changes.resource_changes) {
      const currentResources: any = (character.resources as any) || { gold: 0, contacts: [] }
      const resChange = pcChange.changes.resource_changes

      // Gold changes — clamped to a sane magnitude (see economy.ts) before
      // ever touching the balance, same discipline standing/corruption use.
      if (resChange.gold_delta !== undefined) {
        const goldDelta = clampGoldDelta(resChange.gold_delta)
        currentResources.gold = Math.max(0, (currentResources.gold || 0) + goldDelta)
        console.log(`  💰 ${character.name} ${goldDelta > 0 ? 'gained' : 'spent'} ${Math.abs(goldDelta)} gold (now ${currentResources.gold})`)
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

      updateData.resources = currentResources
    }

    // Debt economy: favors incurred or settled by this scene's fiction —
    // see lib/game/debts.ts for matching semantics.
    if (pcChange.changes.debt_changes && pcChange.changes.debt_changes.length > 0) {
      const debtLog = await applyDebtChanges(
        tx,
        campaignId,
        character.id,
        character.name,
        pcChange.changes.debt_changes,
        currentTurnNumber
      )
      for (const line of debtLog) {
        console.log(`  🤝 ${line}`)
      }
    }

    // Faction standing: social-position shifts earned this scene —
    // clamped to ±1 per scene, bounded ±3 in the writer.
    if (pcChange.changes.standing_changes && pcChange.changes.standing_changes.length > 0) {
      const standingLog = await applyStandingChanges(
        tx,
        campaignId,
        character.id,
        character.name,
        pcChange.changes.standing_changes
      )
      for (const line of standingLog) {
        console.log(`  ⭐ ${line}`)
      }
    }

    // Knowledge-relative sheet: glimpse/unlock/progress signals from the
    // fiction. Deterministic gain math + arc caps live in the writer; the
    // AI only says WHAT happened, never how much.
    if (pcChange.changes.capability_changes && pcChange.changes.capability_changes.length > 0) {
      const capabilityLog = await applyCapabilityChanges(
        tx,
        campaignId,
        character.id,
        pcChange.changes.capability_changes,
        currentTurnNumber,
        'scene'
      )
      for (const line of capabilityLog) {
        console.log(`  📖 ${character.name} — ${line}`)
      }
    }

    if (Object.keys(updateData).length > 0) {
      await tx.character.update({
        where: { id: character.id },
        data: updateData
      })

      console.log(`  🦸 Updated character: ${character.name}`)
    }
  }
}
