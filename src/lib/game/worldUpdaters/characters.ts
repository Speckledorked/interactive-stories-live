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
// thing is still directly unit-tested as one function. See #4/#41
// (stateUpdater decomposition).

import { Prisma, Character } from '@prisma/client'
import type { WorldUpdates } from '@/lib/ai/schema'
import { resolveEntityByNameOrId } from '../entityResolution'
import { resolveOrCreateLocationId } from './locations'
import { clamp } from '../tick/types'
import type { Rng } from '../rng'
import { rollD6 } from '../rng'
import {
  characterMaySacrifice,
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
  appendConditionHistory,
  Condition,
  HarmLevel,
  PermanentInjury,
  ResolvedCondition
} from '../harm'
import { resolveArmorValue, resolveConsumableHeal } from '../inventory'
import { parseKnowledgeState, addKnownConcept, removeKnownConcept } from '../knowledge'
import { applyCapabilityChanges } from '../capabilities'
import { sceneWorldChange } from './sceneWorldEvents'
import type { WorldChange } from '../tick/types'
import { applyDebtChanges, debtChangeFromConsequence, DebtChange } from '../debts'
import { applyStandingChanges } from '../standing'
import { checkCorruptionGate, hasCorruptionGate, describeRefusal } from '../corruptionGates'
import { checkConditionGate, describeConditionRefusal } from '../conditionGates'
import { applyConditionTemplate, stabilizeCharacter } from '../harm'
import { applyGrantBudget, rarityPoints } from '../itemValue'
import { clampGoldDelta, applyGoldDelta, spendGold } from '../economy'
import { normalizeConsequenceList, addRecord, retireAt } from '../consequenceRecords'
import { appendBoundedProse, MAX_CHARACTER_DESCRIPTION_CHARS } from '../textAppend'
import {
  applyCorruptionMarks,
  corruptionStage,
  CONSUMED_CONDITION_NAME,
  CorruptionTheme
} from '../corruption'
import { classifyStressEvents, decideStressDrift, StressSignal } from '../stress'
import type { ActionMechanics } from '../resolution'
import { recordStateMutation } from '../stateMutation'
import { resolveTierKey, tierProgress, type AdvancementTrack } from '../advancementTrack'

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
      const raw = list[index]
      // Entries are ConsequenceRecords now and legacy strings on anything
      // written before that; both have to match, or a removal reported
      // against an old campaign would silently find nothing.
      const entry = typeof raw === 'string' ? raw : (raw as { text?: unknown })?.text
      if (typeof entry !== 'string') continue
      // An already-resolved record is not a candidate: re-reporting a
      // resolution must not rewrite when it ended.
      if (typeof raw === 'object' && raw !== null && (raw as { status?: string }).status === 'resolved') continue
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
 * Derive one WorldChange per Character field a pcChange actually wrote,
 * from the real persisted diff (`updateData`) rather than a hand-
 * maintained parallel log — it can't drift out of sync with what's
 * actually written, the exact class of bug this file's own Fix Log
 * entries have caught before (field-name mismatches, dropped fields).
 * See #175 — this is scene resolution's half of the unified WorldEvent
 * stream tick/consequence changes already write through.
 *
 * Deliberately skips `locationId` (internal FK, redundant with
 * `currentLocation`) and `relationships` (hidden from players by design —
 * see its own schema comment; logging it here would risk surfacing it
 * somewhere with no equivalent fog-of-war gate).
 *
 * One shared `reason` per pcChange rather than a bespoke one per field —
 * the WorldEvent's job is to give SOME narrative context, not be scoped
 * per sub-field; the full reason is always recoverable from the scene's
 * own text.
 */
function buildCharacterWorldChanges(
  campaignId: string,
  character: Character,
  updateData: Record<string, any>,
  reason: string
): WorldChange[] {
  const changes: WorldChange[] = []
  const push = (
    field: string,
    previousValue: string | number,
    newValue: string | number,
    importance: 'NORMAL' | 'MAJOR' = 'NORMAL'
  ) => {
    changes.push(sceneWorldChange(campaignId, 'CHARACTER', character.id, character.name, field, previousValue, newValue, reason, importance))
  }

  if ('currentLocation' in updateData) {
    push('location', character.currentLocation || '(unknown)', updateData.currentLocation)
  }
  if ('harm' in updateData && (character.harm ?? 0) !== updateData.harm) {
    push('harm', character.harm ?? 0, updateData.harm)
  }
  if ('conditions' in updateData) {
    const priorNames = parseHarmState(character.conditions).conditions.map(c => c.name).join(', ') || '(none)'
    const nextNames = (updateData.conditions?.conditions || []).map((c: Condition) => c.name).join(', ') || '(none)'
    if (priorNames !== nextNames) push('conditions', priorNames, nextNames)
  }
  if ('isAlive' in updateData) {
    push('isAlive', character.isAlive ? 'alive' : 'deceased', updateData.isAlive ? 'alive' : 'deceased', 'MAJOR')
  }
  if ('advancementTier' in updateData) {
    push('advancementTier', character.advancementTier || '(unranked)', updateData.advancementTier, 'MAJOR')
  }
  if ('corruption' in updateData && (character.corruption ?? 0) !== updateData.corruption) {
    push('corruption', character.corruption ?? 0, updateData.corruption)
  }
  if ('knownConcepts' in updateData) {
    const priorCount = parseKnowledgeState(character.knownConcepts).concepts.length
    const nextLabels = (updateData.knownConcepts?.concepts || []).map((c: any) => c.label).join('; ') || '(none)'
    push('knownConcepts', `${priorCount} known`, nextLabels)
  }
  if ('consequences' in updateData) {
    const summarize = (c: any) =>
      `${(c?.promises || []).length} promises, ${(c?.enemies || []).length} enemies, ${(c?.longTermThreats || []).length} threats`
    const prior = summarize(character.consequences)
    const next = summarize(updateData.consequences)
    if (prior !== next) push('consequences', prior, next)
  }
  if ('appearance' in updateData) {
    push('appearance', character.appearance || '(none)', updateData.appearance)
  }
  if ('personality' in updateData) {
    push('personality', character.personality || '(none)', updateData.personality)
  }
  if ('equipment' in updateData) {
    const summarize = (e: any) => `weapon: ${e?.weapon || 'none'}, armor: ${e?.armor || 'none'}, misc: ${e?.misc || 'none'}`
    const prior = summarize(character.equipment)
    const next = summarize(updateData.equipment)
    if (prior !== next) push('equipment', prior, next)
  }
  if ('inventory' in updateData) {
    const count = (i: any) => (i?.items || []).length
    const priorCount = count(character.inventory)
    const nextCount = count(updateData.inventory)
    if (priorCount !== nextCount) push('inventory', `${priorCount} items`, `${nextCount} items`)
  }
  if ('resources' in updateData) {
    const summarize = (r: any) => `${r?.gold ?? 0} gold, ${(r?.contacts || []).length} contacts`
    const prior = summarize(character.resources)
    const next = summarize(updateData.resources)
    if (prior !== next) push('resources', prior, next)
  }

  return changes
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
  npcsForResolution: Array<{ id: string; name: string }>,
  getCorruptionTheme: () => Promise<CorruptionTheme | null>,
  // Same lazy shape as getCorruptionTheme: a campaign with no rank ladder
  // never pays for the lookup, and the advancement_tier channel is simply
  // inert for it.
  getAdvancementTrack: () => Promise<AdvancementTrack | null>,
  sceneOrigin: boolean,
  // The engine's own pre-rolled outcome per character this exchange — used
  // to drift Character.stress (see ../stress.ts). Never the AI's
  // outcome_echo self-report. Empty for callers with no rolls to report
  // (e.g. offscreen world-turn narration never touches pc_changes at all).
  actionMechanics: ActionMechanics[] = [],
  // #213: the Taken-Out recovery roll used raw Math.random() inline instead
  // of the same injectable Rng the dice engine (resolution.ts) uses —
  // untestable without globally mocking Math.random. Defaults to
  // Math.random so every real caller (stateUpdater.ts) is unaffected;
  // tests can inject a deterministic sequence instead.
  rng: Rng = Math.random
): Promise<{ gateRefusals: string[]; unresolvedCharacterNames: string[]; worldChanges: WorldChange[] }> {
  console.log(`🦸 Updating ${pcChanges.length} characters`)

  const outcomeByCharacterId = new Map(actionMechanics.map((m) => [m.characterId, m.outcome]))

  // Refusals from corruption gates (#83) — returned rather than pushed into
  // harmMessages, which doubles as the "write harm and conditions" trigger:
  // being turned away from a door is not an injury and must not cause a
  // harm write.
  const gateRefusals: string[] = []
  // A whole pc_changes entry (harm, conditions, knowledge, everything) gets
  // silently dropped whenever character_name_or_id doesn't resolve — this
  // used to be a console.warn only, invisible to anyone but a server log.
  // Collected here so the caller can surface it somewhere a player/admin
  // actually sees (see sceneResolver.ts's synthetic WorldStateChange).
  const unresolvedCharacterNames: string[] = []
  // #175: the unified WorldEvent stream's scene-resolution half — see
  // buildCharacterWorldChanges above.
  const worldChanges: WorldChange[] = []

  for (const pcChange of pcChanges) {
    const pcResolution = resolveEntityByNameOrId(charactersForResolution, pcChange.character_name_or_id)
    const character = pcResolution.kind === 'found' ? pcResolution.entity : null
    if (pcResolution.kind === 'ambiguous') {
      console.warn(`  ⚠️ Ambiguous character name "${pcChange.character_name_or_id}" — matches ${pcResolution.candidates.map(c => c.name).join(', ')}, skipping rather than guessing`)
      unresolvedCharacterNames.push(pcChange.character_name_or_id)
    }

    if (!character) {
      if (pcResolution.kind === 'not_found') {
        console.warn(`  ⚠️ Character not found: ${pcChange.character_name_or_id}`)
        unresolvedCharacterNames.push(pcChange.character_name_or_id)
      }
      continue
    }

    const updateData: any = {}

    // #213: a dead character cannot take more harm, heal, gain/lose
    // conditions, be treated, rest, make a death save, sacrifice
    // themselves again, or gain a corruption mark — each of those checks
    // below is individually gated on character.isAlive rather than
    // skipping the whole pcChange, since non-physical changes (location,
    // knowledge, relationships, inventory, resources) are still legitimate
    // for a deceased character (their gear can still be looted, the party
    // can still learn something about them). Warned once here, matching
    // the "Ambiguous character name" warning above, so a dropped physical
    // change against a dead character isn't silently invisible.
    if (!character.isAlive) {
      const c = pcChange.changes
      const attemptedPhysicalChange =
        (c.harm_damage && c.harm_damage > 0) ||
        (c.harm_healing && c.harm_healing > 0) ||
        (c.conditions_add && c.conditions_add.length > 0) ||
        (c.conditions_remove && c.conditions_remove.length > 0) ||
        c.medical_attention ||
        c.rest_quality ||
        c.death_save_result ||
        c.heroic_sacrifice ||
        c.corruption_change
      if (attemptedPhysicalChange) {
        console.warn(`  ⚠️ ${character.name} is deceased — skipping harm/condition/corruption changes reported against them`)
      }
    }

    // Update location. Also resolves/creates the matching Location row and
    // links it via locationId — the same auto-register-on-movement
    // behavior a separate later pass used to do, now done inline since we
    // need the id anyway (see #425 — Location stored as
    // free text alongside the FK).
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
    let conditionHistory: ResolvedCondition[] = harmState.conditionHistory
    let newIsAlive: boolean | undefined
    let harmMessages: string[] = []

    // Structured, permanent knowledge (#173/#174) — separate column from
    // harm/conditions, tracked independently so a knowledge-only exchange
    // (an NPC explains something, nothing physically changes) still
    // persists without needing a harm/condition message to piggyback on.
    const knowledgeState = parseKnowledgeState(character.knownConcepts)
    let knownConcepts = knowledgeState.concepts
    let knowledgeChanged = false

    if (pcChange.changes.knowledge_add && pcChange.changes.knowledge_add.length > 0) {
      for (const concept of pcChange.changes.knowledge_add) {
        knownConcepts = addKnownConcept(knownConcepts, concept, currentTurnNumber)
      }
      knowledgeChanged = true
    }
    if (pcChange.changes.knowledge_remove && pcChange.changes.knowledge_remove.length > 0) {
      for (const key of pcChange.changes.knowledge_remove) {
        knownConcepts = removeKnownConcept(knownConcepts, key)
      }
      knowledgeChanged = true
    }
    if (knowledgeChanged) {
      updateData.knownConcepts = { concepts: knownConcepts }
    }

    // Apply harm damage (armor mitigates incoming damage) — prefers a
    // structured armorValue on the matching inventory item over guessing
    // from the equipped name string (see resolveArmorValue).
    if (character.isAlive && pcChange.changes.harm_damage && pcChange.changes.harm_damage > 0) {
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
    if (character.isAlive && pcChange.changes.harm_healing && pcChange.changes.harm_healing > 0) {
      const healResult = healHarm(
        currentHarm as HarmLevel,
        pcChange.changes.harm_healing
      )
      currentHarm = healResult.newHarm
      harmMessages.push(healResult.message)
    }

    // Add conditions
    if (character.isAlive && pcChange.changes.conditions_add && pcChange.changes.conditions_add.length > 0) {
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
    if (character.isAlive && pcChange.changes.conditions_remove && pcChange.changes.conditions_remove.length > 0) {
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
          // #173/BUG-012: the event ("was Restrained") must survive even
          // after current state stops saying so — clearCondition already
          // hands back the removed record, this is what actually keeps it.
          if (clearResult.clearedCondition) {
            conditionHistory = appendConditionHistory(conditionHistory, clearResult.clearedCondition, currentTurnNumber)
          }
        }
      }
    }

    // Taken Out for the first time this turn (was under 6, now at 6):
    // resolve the outcome server-side, the same way a GM would roll
    // behind the screen — stabilized, a lasting injury, captured, or
    // critical. Not something the AI decides.
    if (previousHarm < 6 && currentHarm === 6) {
      const roll = rollD6(rng) + rollD6(rng)
      const recovery = performRecoveryRoll(roll, harmMessages.join('; ') || 'Taken Out', currentTurnNumber, rng)
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
    if (character.isAlive && pcChange.changes.medical_attention) {
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
    if (character.isAlive && pcChange.changes.rest_quality) {
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
    if (character.isAlive && wasDying && pcChange.changes.death_save_result) {
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

    // #385: the highest-stakes irreversible transition in the product, and
    // it was reachable from a single AI field with no precondition at all —
    // no confirmation, no harm threshold, no isDying check. Contrast
    // death_save_result immediately above, which IS gated on isDying: the
    // codebase already knows this transition needs a precondition; this
    // path just never got one.
    //
    // The gate is the character's own state, not a new UI flow: a sacrifice
    // is something a character in mortal danger chooses. A character in no
    // danger being narrated into one is the failure mode — whether that
    // comes from a hallucination or from player text steering the model
    // there.
    if (character.isAlive && pcChange.changes.heroic_sacrifice && !characterMaySacrifice(currentConditions, character)) {
      console.warn(
        `  🚫 heroic_sacrifice refused for ${character.name}: only a character already at risk of death may choose it (harm ${character.harm ?? 0})`
      )
    } else if (character.isAlive && pcChange.changes.heroic_sacrifice) {
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

    // Rank movement along the campaign's declared ladder.
    //
    // This is the only writer of Character.advancementTier. Before it existed
    // the column was read by two surfaces and written by nothing, so every
    // character rendered the same rank forever — the ladder was decoration.
    //
    // Closed shape: the GM moves a character ALONG the ladder and may never
    // invent a rung. An undeclared rung is dropped rather than stored,
    // because storing an unknown key renders as "not yet ranked" and would
    // silently undo the promotion the fiction just narrated. Movement in
    // either direction is allowed — demotion and disgrace are real events.
    if (character.isAlive && pcChange.changes.advancement_tier) {
      const track = await getAdvancementTrack()
      const resolved = resolveTierKey(track, pcChange.changes.advancement_tier)
      if (resolved && resolved !== character.advancementTier) {
        updateData.advancementTier = resolved
        const before = tierProgress(track, character.advancementTier)
        const after = tierProgress(track, resolved)
        harmMessages.push(
          `${character.name} is now ${after?.label ?? resolved}${before && !before.unplaced ? ` (was ${before.label})` : ''}.`
        )
      } else if (!resolved) {
        // Named a rung this world does not have. Surfaced rather than
        // swallowed: the narration said a promotion happened and the sheet
        // will not show one, which is exactly the kind of silent divergence
        // the AI Changes panel exists for.
        gateRefusals.push(
          `${character.name}: "${pcChange.changes.advancement_tier}" is not a rank in this world, so no rank change was recorded.`
        )
      }
    }

    // Corruption marks — only when this campaign actually has a
    // corruption theme (a universe without one ignores the field
    // entirely). Clamped to one mark per scene, never decreases;
    // reaching the cap adds the Consumed condition (see corruption.ts).
    if (character.isAlive && pcChange.changes.corruption_change) {
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
        deathSaves,
        conditionHistory
      }
      if (newIsAlive !== undefined) {
        updateData.isAlive = newIsAlive
      }
      console.log(`  💔 ${character.name}: ${harmMessages.join(', ')}`)
    }

    // Phase 14: Process relationship changes
    if (pcChange.changes.relationship_changes && pcChange.changes.relationship_changes.length > 0) {
      const currentRelationships: any = (character.relationships as any) || {}
      let anyRelationshipApplied = false

      for (const relChange of pcChange.changes.relationship_changes) {
        // Resolve the AI-reported entity_id/entity_name against the real
        // NPC roster before using it as a Character.relationships key —
        // every reader looks this map up by real NPC id, so writing the
        // AI's raw entity_id straight in orphans the key the moment an AI
        // reports a name or a stale/garbage id instead of the real one
        // (checkKey 'character.relationships.keys.resolve').
        let npcResolution = resolveEntityByNameOrId(npcsForResolution, relChange.entity_id)
        // Tracks which field actually resolved it, for the StateMutation
        // audit trail below — a resolution that needed the entity_name
        // fallback is a REPAIR (the reported entity_id alone wasn't
        // enough), not a clean ACCEPT.
        let resolvedViaNameFallback = false
        // The prompt's own example shows a placeholder id like "npc_123",
        // so a reported entity_name that resolves for real is the routine
        // fallback, not the exceptional case.
        if (npcResolution.kind !== 'found') {
          npcResolution = resolveEntityByNameOrId(npcsForResolution, relChange.entity_name)
          resolvedViaNameFallback = true
        }
        if (npcResolution.kind !== 'found') {
          console.warn(`  ⚠️ ${character.name} → unresolved relationship target "${relChange.entity_name}" (${relChange.entity_id}), skipping`)
          await recordStateMutation(tx, {
            campaignId,
            field: `character.${character.id}.relationships.${relChange.entity_id}`,
            proposedValue: relChange,
            result: 'REJECTED',
            reason: `unresolved relationship target "${relChange.entity_name}" (${relChange.entity_id})`,
          })
          continue
        }
        const entityId = npcResolution.entity.id
        const currentRel = currentRelationships[entityId] || {
          trust: 0,
          tension: 0,
          respect: 0,
          fear: 0
        }

        // Apply deltas and clamp between -100 and 100
        const nextRel = {
          trust: relChange.trust_delta !== undefined ? clamp(currentRel.trust + relChange.trust_delta, -100, 100) : currentRel.trust,
          tension: relChange.tension_delta !== undefined ? clamp(currentRel.tension + relChange.tension_delta, -100, 100) : currentRel.tension,
          respect: relChange.respect_delta !== undefined ? clamp(currentRel.respect + relChange.respect_delta, -100, 100) : currentRel.respect,
          fear: relChange.fear_delta !== undefined ? clamp(currentRel.fear + relChange.fear_delta, -100, 100) : currentRel.fear
        }
        currentRelationships[entityId] = nextRel

        // ACCEPTED vs REPAIRED: needing the entity_name fallback means the
        // reported entity_id alone didn't resolve — the change still
        // landed, but not exactly as proposed.
        await recordStateMutation(tx, {
          campaignId,
          field: `character.${character.id}.relationships.${entityId}`,
          previousValue: currentRel,
          proposedValue: relChange,
          repairedValue: resolvedViaNameFallback ? nextRel : undefined,
          result: resolvedViaNameFallback ? 'REPAIRED' : 'ACCEPTED',
        })

        anyRelationshipApplied = true
        console.log(`  🤝 ${character.name} → ${relChange.entity_name}: ${relChange.reason}`)
      }

      // Only write when something actually resolved — a batch where every
      // change named an unknown NPC shouldn't rewrite the column with an
      // unchanged value.
      if (anyRelationshipApplied) {
        updateData.relationships = currentRelationships
      }
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
          currentConsequences[typeKey] = addRecord(
            normalizeConsequenceList(currentConsequences[typeKey]),
            newConseq.description,
            currentTurnNumber
          )
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
            // Retired, not deleted. "The contract that hunted you for six
            // sessions is over" is something the character survived; splicing
            // it made that indistinguishable from it never having happened.
            currentConsequences[removal.key] = retireAt(
              normalizeConsequenceList(currentConsequences[removal.key]),
              removal.index,
              currentTurnNumber
            )
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
            if (healAmount > 0 && character.isAlive) {
              const healResult = healHarm(currentHarm as HarmLevel, healAmount)
              currentHarm = healResult.newHarm
              harmMessages.push(`${character.name} uses ${removedItem.name}: ${healResult.message}`)
              updateData.harm = currentHarm
              updateData.conditions = { ...harmState, conditions: currentConditions, permanentInjuries, deathSaves, conditionHistory }
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
              if (healAmount > 0 && character.isAlive) {
                const healResult = healHarm(currentHarm as HarmLevel, healAmount)
                currentHarm = healResult.newHarm
                harmMessages.push(`${character.name} uses ${Math.abs(modify.quantity_delta)}x ${item.name}: ${healResult.message}`)
                updateData.harm = currentHarm
                updateData.conditions = { ...harmState, conditions: currentConditions, permanentInjuries, deathSaves, conditionHistory }
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
      //
      // A SPEND is gated; a gain is not. applyGoldDelta floors at 0, which is
      // correct for a credit and was quietly wrong for a purchase: spending
      // 200 with 50 in hand produced a balance of 0 and let the purchase
      // stand. Nobody could ever fail to afford anything — they could only be
      // drained — so "I can't cover this" never became a reason to bargain,
      // borrow, lie or steal. An economy that cannot refuse is decoration.
      if (resChange.gold_delta !== undefined) {
        const goldDelta = clampGoldDelta(resChange.gold_delta)

        if (goldDelta < 0) {
          const outcome = spendGold(currentResources.gold, goldDelta)
          if (outcome.refused) {
            // Nothing is taken. The narrator described a purchase that did
            // not happen, and that divergence between prose and state is
            // exactly what gateRefusals exists to carry.
            gateRefusals.push(
              `${character.name} could not afford to spend ${Math.abs(goldDelta)} ` +
              `(has ${outcome.gold}, short ${outcome.shortfall}) — nothing was paid`
            )
            console.log(
              `  💰 ${character.name} REFUSED: cannot spend ${Math.abs(goldDelta)}, ` +
              `has ${outcome.gold} (short ${outcome.shortfall})`
            )
          } else {
            currentResources.gold = outcome.gold
            console.log(`  💰 ${character.name} spent ${outcome.spent} gold (now ${outcome.gold})`)
          }
        } else {
          currentResources.gold = applyGoldDelta(currentResources.gold, resChange.gold_delta)
          console.log(`  💰 ${character.name} gained ${goldDelta} gold (now ${currentResources.gold})`)
        }
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

    // Accumulated psychological pressure (see ../stress.ts) — classified
    // from signals already computed above for OTHER reasons this same
    // pass (the engine's own outcome for this character, applied harm, an
    // applied corruption mark) plus what this exchange reported for
    // consequences. Runs for every character with a pc_changes entry, not
    // just ones with a raise event — a quiet exchange with none of the
    // raise signals is exactly what lets stress recover. Deliberately
    // never logged to worldChanges (buildCharacterWorldChanges has no
    // 'stress' case): background drift, same as belief/disposition
    // vectors, not a narrated history event.
    const stressSignal: StressSignal = {
      outcome: outcomeByCharacterId.get(character.id),
      // #322/#327: gated on isAlive the same way the harm APPLICATION
      // above (line ~381) is — harm_damage the engine refuses to apply to
      // a dead character's harm track (see that guard) shouldn't still
      // drift their stress upward via this second, independent read of
      // the same raw AI-reported field.
      harmDamage: character.isAlive ? pcChange.changes.harm_damage : undefined,
      consequenceTypesAdded: pcChange.changes.consequences_add?.map((c) => c.type),
      gainedCorruptionMark: 'corruption' in updateData && (character.corruption ?? 0) !== updateData.corruption,
    }
    const nextStress = decideStressDrift(character.stress ?? 0, classifyStressEvents(stressSignal))
    if (nextStress !== (character.stress ?? 0)) {
      updateData.stress = nextStress
    }

    if (Object.keys(updateData).length > 0) {
      worldChanges.push(...buildCharacterWorldChanges(campaignId, character, updateData, harmMessages.join('; ') || 'Scene resolution'))

      await tx.character.update({
        where: { id: character.id },
        data: updateData
      })

      console.log(`  🦸 Updated character: ${character.name}`)
    }
  }

  return { gateRefusals, unresolvedCharacterNames, worldChanges }
}

/**
 * Corruption AND condition gate for a location a character is trying to
 * MOVE INTO (#83, #206).
 *
 * Boundary-only by construction: this is called from the location-change
 * branch, so it can only ever refuse a move. Where a character already
 * stands is never re-checked — with irreversible corruption marks, that
 * would eject someone through a door they could never re-enter. Condition
 * gating rides the same boundary for consistency, even though its own
 * state (conditionScore) isn't irreversible the way marks are — a party
 * that already stood in a location before it decayed is still never
 * ejected, matching the "never retroactive" discipline this gate exists
 * to enforce either way.
 *
 * Fails OPEN on every uncertainty — no such location yet, a lookup error,
 * no corruption theme. A gate that accidentally refuses movement strands
 * the party; one that accidentally permits it costs a moment of flavor.
 */
async function checkLocationEntryGate(
  tx: Db,
  campaignId: string,
  locationName: string,
  corruption: number,
  getCorruptionTheme: () => Promise<CorruptionTheme | null>
): Promise<{ allowed: boolean; message?: string }> {
  try {
    const location = await tx.location.findUnique({
      where: { campaignId_name: { campaignId, name: locationName } },
      select: { minCorruption: true, maxCorruption: true, conditionScore: true, isContested: true },
    })
    // A location the fiction is inventing right now can't be gated — there
    // is no row yet to carry a gate.
    if (!location) return { allowed: true }

    // #206: condition gate first — universe-theme-independent (a collapsed
    // bridge is a collapsed bridge in any setting), so it never needs
    // getCorruptionTheme at all.
    const conditionGate = checkConditionGate(location)
    if (!conditionGate.allowed) {
      return { allowed: false, message: describeConditionRefusal(conditionGate.refusal!) }
    }

    if (!hasCorruptionGate(location)) return { allowed: true }
    const theme = await getCorruptionTheme()
    if (!theme) return { allowed: true }

    const gate = checkCorruptionGate(location, corruption, true)
    if (gate.allowed) return { allowed: true }
    return { allowed: false, message: describeRefusal(gate.refusal!, theme.name) }
  } catch (error) {
    console.error('Location entry gate check failed (allowing movement):', error)
    return { allowed: true }
  }
}
