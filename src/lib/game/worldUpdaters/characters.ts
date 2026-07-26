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
import { clamp } from '../tick/types'
import {
  applyHarm,
  healHarm,
  markCondition,
  clearCondition,
  performRecoveryRoll,
  makeDeathSave,
  applyMedicalAttention,
  applyRest,
  performHeroicSacrifice,
  isDying,
  parseHarmState,
  Condition,
  HarmLevel,
  PermanentInjury
} from '../harm'
import { resolveArmorValue, resolveConsumableHeal } from '../inventory'
import { applyCapabilityChanges } from '../capabilities'
import { applyDebtChanges, debtChangeFromConsequence, DebtChange } from '../debts'
import { applyStandingChanges } from '../standing'
import { checkCorruptionGate, hasCorruptionGate, describeRefusal } from '../corruptionGates'
import { applyConditionTemplate, stabilizeCharacter } from '../harm'
import { applyGrantBudget, rarityPoints } from '../itemValue'
import { clampGoldDelta } from '../economy'
import { appendBoundedProse, MAX_CHARACTER_DESCRIPTION_CHARS } from '../textAppend'
import {
  applyCorruptionMarks,
  corruptionStage,
  CONSUMED_CONDITION_NAME,
  CorruptionTheme
} from '../corruption'

type Db = Prisma.TransactionClient
export type PcChange = NonNullable<WorldUpdates['pc_changes']>[number]
type EquipmentSlotChange = NonNullable<NonNullable<PcChange['changes']['equipment_changes']>['weapon']>

/** The add/replace/remove shape shared by the weapon/armor/misc equipment slots. */
function applyEquipmentSlotChange(
  currentEquipment: Record<string, string>,
  slot: 'weapon' | 'armor' | 'misc',
  change: EquipmentSlotChange,
  characterName: string,
  emoji: string
): void {
  if (change.action === 'add' || change.action === 'replace') {
    currentEquipment[slot] = change.value
    console.log(`  ${emoji} ${characterName} equipped ${slot}: ${change.value}`)
  } else if (change.action === 'remove') {
    console.log(`  ${emoji} ${characterName} lost ${slot}: ${currentEquipment[slot] || change.value}`)
    currentEquipment[slot] = ''
  }
}

/**
 * Locate the single consequence entry a `consequences_remove` string means.
 *
 * Pure and exported for direct testing. Returns which array and index to
 * splice, or null if nothing matched.
 *
 * The point is that it removes ONE thing. The previous implementation
 * filtered every consequence array by substring at once, so resolving
 * "owes Kessler a favor" could simultaneously strike a promise, an enemy
 * and a long-term threat that merely shared that wording — a silent,
 * unrecoverable data loss triggered by ordinary AI phrasing.
 *
 * An exact (case-insensitive) match anywhere wins outright. Failing that,
 * the SHORTEST substring match is taken, on the reasoning that the
 * shortest containing entry is the most specific one rather than an
 * incidentally longer entry that happens to quote the same phrase.
 */
export function findConsequenceToRemove(
  consequences: Record<string, unknown>,
  toRemove: string
): { key: string; index: number; matched: string } | null {
  const needle = toRemove.trim().toLowerCase()
  if (!needle) return null

  let fallback: { key: string; index: number; matched: string } | null = null

  for (const key of Object.keys(consequences)) {
    const list = consequences[key]
    if (!Array.isArray(list)) continue

    for (let index = 0; index < list.length; index++) {
      const entry = list[index]
      if (typeof entry !== 'string') continue
      const hay = entry.trim().toLowerCase()

      if (hay === needle) return { key, index, matched: entry }

      if (hay.includes(needle) && (!fallback || entry.length < fallback.matched.length)) {
        fallback = { key, index, matched: entry }
      }
    }
  }

  return fallback
}

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
): Promise<string[]> {
  console.log(`🦸 Updating ${pcChanges.length} characters`)

  // Refusals from corruption gates (#83) — returned rather than pushed into
  // harmMessages, which doubles as the "write harm and conditions" trigger:
  // being turned away from a door is not an injury and must not cause a
  // harm write.
  const gateRefusals: string[] = []

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
      // Corruption gate on ENTRY (#83). Checked only for a MOVE, never
      // against where the character already is: marks are irreversible, so
      // re-evaluating a standing location would eject someone through a
      // door they already walked through and could never re-enter.
      const entry = await checkLocationEntryGate(
        tx, campaignId, pcChange.changes.location, character.corruption ?? 0, getCorruptionTheme
      )
      if (entry.allowed) {
        updateData.currentLocation = pcChange.changes.location
        updateData.locationId = await resolveOrCreateLocationId(tx, campaignId, pcChange.changes.location, sceneOrigin)
      } else {
        gateRefusals.push(`${character.name} could not enter ${pcChange.changes.location} — ${entry.message}`)
        console.log(`  🌑 ${character.name} turned away from ${pcChange.changes.location} — corruption gate`)
      }
    }

    // Process harm and conditions
    const previousHarm = (character.harm as number) || 0
    let currentHarm = previousHarm
    // Read the whole blob once, and keep it. The three write sites below
    // used to rebuild `conditions` from exactly these three named fields,
    // which silently DROPPED anything else living in there — restHours,
    // added for natural recovery, was being reset to zero by every harm
    // event, so a character who took a scratch lost days of mending.
    // Spreading the parsed state writes a COMPLETE HarmState every time,
    // so a field this function has no opinion about survives it. (Unknown
    // keys are still dropped — parseHarmState is typed on purpose. The way
    // a new field stays safe is by being in HarmState, not by the blob
    // accumulating whatever anyone happened to write.)
    const harmState = parseHarmState(character.conditions)
    let currentConditions: Condition[] = harmState.conditions
    let permanentInjuries: PermanentInjury[] = harmState.permanentInjuries
    let deathSaves: number = harmState.deathSaves
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
      for (const rawCondition of pcChange.changes.conditions_add) {
        // Fill the enforced fields in from the stock catalogue where the
        // report left them out (COMMON_CONDITIONS). Without this the
        // catalogue had no production consumer at all: a narrator writing
        // "Bleeding" got whatever fields it happened to report, which was
        // usually none, so the entry specifying 1 harm per scene was only
        // ever true of a table nobody read. Reported values still win.
        const conditionData = applyConditionTemplate(rawCondition)
        const newCondition: Condition = {
          id: conditionData.id || `condition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: conditionData.name,
          category: conditionData.category,
          description: conditionData.description,
          mechanicalEffect: conditionData.mechanicalEffect,
          // The ENFORCED fields, all three of which were being dropped here.
          //
          // rollModifier's own schema comment promises "the AI can also set
          // this directly on a custom condition it authors, not just the
          // fixed templates" — but this writer never copied it, so every
          // AI-authored condition reached the dice as flavor no matter what
          // number it reported. Same class of defect as #88 itself: a field
          // that is read at one end and never written at the other.
          rollModifier: conditionData.rollModifier,
          harmPerScene: conditionData.harmPerScene,
          statModifiers: conditionData.statModifiers,
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

    // A stretch of real rest in the fiction. Deliberately AFTER treatment,
    // so a night that included both is worth both — the same ordering
    // harm_healing already has, and the order a story tells it in.
    //
    // Conditions are passed so bleeding blocks it: the slow calendar path
    // (accrueNaturalRecovery) already refuses to mend an open wound, and a
    // narrated night's sleep must not become the way around that rule.
    if (pcChange.changes.rest_quality) {
      const rested = applyRest(
        currentHarm as HarmLevel,
        pcChange.changes.rest_quality,
        currentConditions
      )
      currentHarm = rested.newHarm
      harmMessages.push(rested.message)
    }

    // Already critically dying: apply whatever the AI narrated this turn.
    const wasDying = isDying(currentHarm as HarmLevel, currentConditions)
    if (wasDying && pcChange.changes.death_save_result) {
      const save = makeDeathSave(deathSaves, pcChange.changes.death_save_result === 'success')
      deathSaves = save.newDeathSaves
      harmMessages.push(save.message)

      if (save.status === 'stable') {
        // Through stabilizeCharacter rather than hand-built here. That
        // function existed with no callers while this branch duplicated
        // it — two definitions of what stabilizing does, free to drift,
        // and canAct() reads the mechanicalEffect text of both.
        const stabilized = stabilizeCharacter(currentConditions, currentTurnNumber)
        currentConditions = stabilized.updatedConditions
        harmMessages.push(stabilized.message)
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
        ...harmState,
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
        currentRelationships[entityId] = {
          trust: relChange.trust_delta !== undefined ? clamp(currentRel.trust + relChange.trust_delta, -100, 100) : currentRel.trust,
          tension: relChange.tension_delta !== undefined ? clamp(currentRel.tension + relChange.tension_delta, -100, 100) : currentRel.tension,
          respect: relChange.respect_delta !== undefined ? clamp(currentRel.respect + relChange.respect_delta, -100, 100) : currentRel.respect,
          fear: relChange.fear_delta !== undefined ? clamp(currentRel.fear + relChange.fear_delta, -100, 100) : currentRel.fear
        }

        console.log(`  🤝 ${character.name} → ${relChange.entity_name}: ${relChange.reason}`)
      }

      updateData.relationships = currentRelationships
    }

    // Debts reported through the consequence channel (#69). Collected here
    // and handed to applyDebtChanges below alongside debt_changes, so both
    // routes end up writing the same Debt rows.
    const consequenceDebts: DebtChange[] = []

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
          // 'debt' is an alias for the real Debt model, not a consequence
          // array — see debtChangeFromConsequence. Nothing is written to
          // consequences.debts anymore; the shadow representation is what
          // #69 was about.
          if (newConseq.type === 'debt') {
            const debt = debtChangeFromConsequence(newConseq)
            if (debt) {
              consequenceDebts.push(debt)
            } else {
              console.warn(
                `  ⚠️ ${character.name}: consequences_add debt has no counterparty_name — ` +
                `a debt owed to nobody can never be called in, so it was dropped: "${newConseq.description}"`
              )
            }
            continue
          }
          const typeKey = newConseq.type === 'longTermThreat' ? 'longTermThreats' : newConseq.type + 's'
          if (!currentConsequences[typeKey]) {
            currentConsequences[typeKey] = []
          }
          currentConsequences[typeKey].push(newConseq.description)
          console.log(`  ⚠️ ${character.name} gained ${newConseq.type}: ${newConseq.description}`)
        }
      }

      // Remove consequences.
      //
      // Removes at most ONE entry per reported string — the single best
      // match across the arrays. The previous implementation filtered every
      // array by substring simultaneously, so resolving "owes Kessler a
      // favor" could silently strike a promise, an enemy AND a threat that
      // merely shared that wording. An exact match anywhere wins outright;
      // otherwise the shortest substring match is taken as the most
      // specific one, and if nothing matches it's logged rather than
      // silently doing nothing.
      if (pcChange.changes.consequences_remove) {
        for (const toRemove of pcChange.changes.consequences_remove) {
          const removal = findConsequenceToRemove(currentConsequences, toRemove)
          if (removal) {
            currentConsequences[removal.key].splice(removal.index, 1)
            console.log(`  ✅ ${character.name} resolved consequence: ${removal.matched}`)
          } else {
            console.warn(`  ⚠️ ${character.name}: no consequence matched "${toRemove}" — nothing removed`)
          }
        }
      }

      updateData.consequences = currentConsequences
    }

    // Process appearance changes
    if (pcChange.changes.appearance_changes) {
      const appearanceChange = pcChange.changes.appearance_changes
      if (appearanceChange.append) {
        updateData.appearance = appendBoundedProse(
          character.appearance,
          appearanceChange.description,
          MAX_CHARACTER_DESCRIPTION_CHARS
        )
      } else {
        updateData.appearance = appearanceChange.description
      }
      console.log(`  👁️ ${character.name} appearance changed: ${appearanceChange.description}`)
    }

    // Process personality changes
    if (pcChange.changes.personality_changes) {
      const personalityChange = pcChange.changes.personality_changes
      if (personalityChange.append) {
        updateData.personality = appendBoundedProse(
          character.personality,
          personalityChange.description,
          MAX_CHARACTER_DESCRIPTION_CHARS
        )
      } else {
        updateData.personality = personalityChange.description
      }
      console.log(`  🧠 ${character.name} personality changed: ${personalityChange.description}`)
    }

    // Process equipment changes
    if (pcChange.changes.equipment_changes) {
      const currentEquipment: any = (character.equipment as any) || {}
      const equipChange = pcChange.changes.equipment_changes

      if (equipChange.weapon) applyEquipmentSlotChange(currentEquipment, 'weapon', equipChange.weapon, character.name, '⚔️')
      if (equipChange.armor) applyEquipmentSlotChange(currentEquipment, 'armor', equipChange.armor, character.name, '🛡️')
      if (equipChange.misc) applyEquipmentSlotChange(currentEquipment, 'misc', equipChange.misc, character.name, '🎒')

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

      // Add items, subject to the per-arc rarity budget (#44/#47). A
      // narrator asked to reward players will reward them every scene, so
      // scarcity has to be enforced deterministically — same guardrail
      // shape as the perk/move caps (#65). Common items are effectively
      // unbudgeted; a legendary costs the whole arc.
      if (invChange.items_add) {
        const budget = applyGrantBudget(currentInventory.items, invChange.items_add, currentTurnNumber)
        for (const skippedItem of budget.skipped) {
          console.warn(
            `  📦 ${character.name}: "${skippedItem.name}" (${skippedItem.rarity || 'common'}) exceeds this arc's rarity budget — not granted`
          )
        }
        for (const newItem of budget.granted) {
          // Stamped so the NEXT budget check can derive spend from the
          // inventory itself rather than from a counter that can drift.
          const stamped = { ...newItem, grantedTurn: currentTurnNumber }
          // Check if item already exists, if so increase quantity
          const existingItem = currentInventory.items.find((item: any) => item.id === newItem.id)
          if (existingItem) {
            existingItem.quantity += newItem.quantity
            // Re-stamp: a fresh grant restarts this stack's arc clock, or a
            // stack topped up every scene would evade the budget forever.
            existingItem.grantedTurn = currentTurnNumber
            console.log(`  📦 ${character.name} gained ${newItem.quantity}x ${newItem.name} (now ${existingItem.quantity})`)
          } else {
            currentInventory.items.push(stamped)
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
              updateData.conditions = { ...harmState, conditions: currentConditions, permanentInjuries, deathSaves }
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
                updateData.conditions = { ...harmState, conditions: currentConditions, permanentInjuries, deathSaves }
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
    const allDebtChanges = [...(pcChange.changes.debt_changes || []), ...consequenceDebts]
    if (allDebtChanges.length > 0) {
      const debtLog = await applyDebtChanges(
        tx,
        campaignId,
        character.id,
        character.name,
        allDebtChanges,
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

  return gateRefusals
}

/**
 * Corruption gate for a location a character is trying to MOVE INTO (#83).
 *
 * Boundary-only by construction: this is called from the location-change
 * branch, so it can only ever refuse a move. Where a character already
 * stands is never re-checked — with irreversible marks, that would eject
 * someone through a door they could never re-enter.
 *
 * Fails OPEN on every uncertainty — no theme, no such location yet, a
 * lookup error. A gate that accidentally refuses movement strands the
 * party; one that accidentally permits it costs a moment of flavor.
 */
async function checkLocationEntryGate(
  tx: Db,
  campaignId: string,
  locationName: string,
  corruption: number,
  getCorruptionTheme: () => Promise<CorruptionTheme | null>
): Promise<{ allowed: boolean; message?: string }> {
  try {
    const theme = await getCorruptionTheme()
    if (!theme) return { allowed: true }

    const location = await tx.location.findUnique({
      where: { campaignId_name: { campaignId, name: locationName } },
      select: { minCorruption: true, maxCorruption: true },
    })
    // A location the fiction is inventing right now can't be gated — there
    // is no row yet to carry a gate.
    if (!location || !hasCorruptionGate(location)) return { allowed: true }

    const gate = checkCorruptionGate(location, corruption, true)
    if (gate.allowed) return { allowed: true }
    return { allowed: false, message: describeRefusal(gate.refusal!, theme.name) }
  } catch (error) {
    console.error('Corruption entry gate check failed (allowing movement):', error)
    return { allowed: true }
  }
}
