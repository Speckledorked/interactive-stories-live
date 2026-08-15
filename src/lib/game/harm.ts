// src/lib/game/harm.ts
// Harm and Conditions System
// Implements a 6-segment harm track and condition management

import type { Rng } from './rng'
import { CONSUMED_CONDITION_NAME } from './corruption'

/**
 * Harm Track States
 * 0-3: Fine (no mechanical penalties)
 * 4-5: Impaired (-1 to all rolls)
 * 6: Taken Out (unconscious, captured, or dying)
 */
export type HarmLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * Condition Categories
 */
export type ConditionCategory = 'Physical' | 'Emotional' | 'Special'

/**
 * A character condition
 */
export interface Condition {
  id: string
  name: string
  category: ConditionCategory
  description: string
  // Display-only flavor text — never parsed for enforcement (a
  // freeform string like "-2 to rolls using that limb" can't be
  // reliably turned into a number, and several COMMON_CONDITIONS below
  // are deliberately directional/situational in exactly this text).
  // See rollModifier for the deterministic side.
  mechanicalEffect?: string // e.g., "-1 to social rolls"
  // The actual number computeMechanics applies to every roll while this
  // condition is active (see conditionPenalty in resolution.ts) — a flat,
  // universal modifier, the same simplification weatherPenalty/harmPenalty
  // already make elsewhere in this engine. Only set for conditions whose
  // real-world effect is genuinely flat/undirected; a condition whose
  // flavor text is inherently situational (Enraged's "+1 combat/-2
  // social", Terrified's "vs. the source of fear") is left unset here
  // rather than force a number that would be wrong half the time — see
  // COMMON_CONDITIONS below for which is which. The AI can also set this
  // directly on a custom condition it authors (schema.ts clamps it to
  // -2..2), not just the fixed templates.
  rollModifier?: number
  // Harm this condition inflicts at the start of each scene (#88).
  //
  // mechanicalEffect could always SAY "1 harm per turn" — Bleeding did,
  // from the day it was written — but nothing anywhere applied it, so the
  // sheet stated a rule the engine never executed. This is the number that
  // actually gets applied, the same split rollModifier already makes
  // between the readable text and the enforced value.
  //
  // Deliberately capped below the Taken Out threshold when applied (see
  // RECURRING_HARM_CEILING): a condition ticking away between scenes must
  // not kill someone while nobody is looking. Taken Out is resolved by a
  // server-side recovery roll during scene resolution, where it can be
  // narrated; bleeding out in a gap between scenes has no such moment.
  harmPerScene?: number
  // Per-stat roll modifiers, for conditions whose real effect is stat-
  // shaped rather than flat (#88). Enraged's "+1 to combat rolls, -2 to
  // social rolls" is exactly this, and had NO enforcement at all because
  // rollModifier can only express one undirected number.
  //
  // Keyed by PbtA stat: cool (nerve), hard (force/violence), hot
  // (charm/social), sharp (perception/wits), weird (the strange). Composes
  // additively with rollModifier — a condition may set either, both, or
  // neither.
  statModifiers?: Partial<Record<'cool' | 'hard' | 'hot' | 'sharp' | 'weird', number>>
  appliedAt?: number // Turn number when applied
}

/**
 * A resolved condition — the EVENT half of BUG-004/BUG-012's event-vs-
 * current-state distinction ("the character was restrained" persists even
 * after "is currently restrained" becomes false). `clearCondition` already
 * returned the removed record; nothing persisted it, so once a condition
 * was cleared there was no record it had ever existed. See
 * `appendConditionHistory` below — the only writer.
 */
export interface ResolvedCondition {
  name: string
  category: ConditionCategory
  appliedAt?: number // Turn number when applied, if known
  resolvedAt: number // Turn number when cleared
}

/**
 * The persisted contents of `Character.conditions`.
 *
 * This interface used to describe a shape nothing anywhere stored: it
 * carried `currentHarm`, which lives in its own `Character.harm` column
 * and has never been in this blob, and typed `permanentInjuries` as
 * `string[]` where every writer puts `PermanentInjury` objects. Both of
 * its helpers were unreferenced, so nothing ever forced the description to
 * meet the data — and `validateHarmState` would in fact have rejected
 * every real row in the database.
 *
 * Harm itself is deliberately NOT here. It is a column so it can be
 * queried (`harm: { gt: 0, lt: 6 }` selects who is mending), and
 * duplicating it into the blob would create two sources of truth for the
 * one number the whole system turns on.
 */
export interface HarmState {
  conditions: Condition[]
  deathSaves: number // For death spiral mechanics
  permanentInjuries: PermanentInjury[]
  /** Carried in-game hours toward the next point of natural recovery. */
  restHours: number
  /**
   * Append-only log of resolved (cleared) conditions — see
   * `ResolvedCondition`. Bounded like every other append-only field in
   * this codebase (see `MAX_WIKI_CHANGELOG_ENTRIES`/`MAX_GM_NOTES_HISTORY`);
   * oldest entries fall off rather than accumulating for the campaign's
   * whole life.
   */
  conditionHistory: ResolvedCondition[]
}

/**
 * Get the harm status text for UI display
 */
export function getHarmStatus(harm: HarmLevel): {
  status: 'Fine' | 'Impaired' | 'Taken Out'
  description: string
  penalty: number
} {
  if (harm <= 3) {
    return {
      status: 'Fine',
      description: 'No significant injuries',
      penalty: 0
    }
  } else if (harm <= 5) {
    return {
      status: 'Impaired',
      description: 'Wounded and struggling (-1 to all rolls)',
      penalty: -1
    }
  } else {
    return {
      status: 'Taken Out',
      description: 'Unconscious, captured, or dying',
      penalty: -999 // Cannot act
    }
  }
}

/**
 * Apply harm to a character
 * Returns new harm level (capped at 6) and any automatic conditions
 */
export function applyHarm(
  currentHarm: HarmLevel,
  damage: number,
  armorReduction: number = 0
): {
  newHarm: HarmLevel
  autoConditions: Condition[]
  message: string
} {
  const actualDamage = Math.max(0, damage - armorReduction)
  const newHarmValue = Math.min(6, currentHarm + actualDamage) as HarmLevel

  const autoConditions: Condition[] = []
  let message = `Takes ${actualDamage} harm`

  // Check for threshold crossings
  if (currentHarm <= 3 && newHarmValue >= 4) {
    message += ' and becomes Impaired (-1 to all rolls)'
  }

  if (newHarmValue === 6) {
    message += ' and is Taken Out!'
    // From the catalogue rather than hand-built here, so there is exactly
    // one definition of what Taken Out means. canAct() keys off
    // "cannot take actions" in this text, so the two must not drift.
    autoConditions.push(createConditionFromTemplate('taken_out'))
  }

  return {
    newHarm: newHarmValue,
    autoConditions,
    message
  }
}

/**
 * Heal harm
 * Cannot heal below 0, and may require conditions to be cleared first
 */
export function healHarm(
  currentHarm: HarmLevel,
  healing: number
): {
  newHarm: HarmLevel
  message: string
} {
  const newHarmValue = Math.max(0, currentHarm - healing) as HarmLevel

  let message = `Heals ${healing} harm`

  // Check for threshold crossings
  if (currentHarm === 6 && newHarmValue < 6) {
    message += ' and is no longer Taken Out'
  }

  if (currentHarm >= 4 && newHarmValue <= 3) {
    message += ' and is no longer Impaired'
  }

  return {
    newHarm: newHarmValue,
    message
  }
}

/**
 * Mark a condition on a character
 */
export function markCondition(
  conditions: Condition[],
  newCondition: Condition
): {
  updatedConditions: Condition[]
  message: string
} {
  // Check if condition already exists
  const existingIndex = conditions.findIndex(c => c.id === newCondition.id)

  if (existingIndex >= 0) {
    // Update existing condition
    const updated = [...conditions]
    updated[existingIndex] = newCondition
    return {
      updatedConditions: updated,
      message: `Updated condition: ${newCondition.name}`
    }
  } else {
    // Add new condition
    return {
      updatedConditions: [...conditions, newCondition],
      message: `Marked with condition: ${newCondition.name}`
    }
  }
}

/**
 * Clear a condition from a character
 */
export function clearCondition(
  conditions: Condition[],
  conditionId: string
): {
  updatedConditions: Condition[]
  clearedCondition?: Condition
  message: string
} {
  const index = conditions.findIndex(c => c.id === conditionId)

  if (index === -1) {
    return {
      updatedConditions: conditions,
      message: 'Condition not found'
    }
  }

  const clearedCondition = conditions[index]
  const updatedConditions = conditions.filter(c => c.id !== conditionId)

  return {
    updatedConditions,
    clearedCondition,
    message: `Cleared condition: ${clearedCondition.name}`
  }
}

/**
 * Check if a character can act
 */
export function canAct(harm: HarmLevel, conditions: Condition[]): boolean {
  // Cannot act if taken out
  if (harm >= 6) {
    return false
  }

  // Cannot act if any condition prevents it. Consumed (corruption's
  // terminal stage — see corruption.ts) is checked by name, not by
  // mechanicalEffect substring: its own text ("The final stage of
  // corruption — irreversible") deliberately doesn't match either
  // phrase, and #290 found that left it mechanically identical to any
  // ordinary condition — full stat rolls, full agency, no lockout —
  // despite the character being "slipping beyond the player's control"
  // per its own description.
  const hasIncapacitatingCondition = conditions.some(c =>
    c.mechanicalEffect?.toLowerCase().includes('cannot take actions') ||
    c.mechanicalEffect?.toLowerCase().includes('cannot act') ||
    c.name === CONSUMED_CONDITION_NAME
  )

  return !hasIncapacitatingCondition
}

/**
 * Initialize default harm state for a new character
 */
export function createDefaultHarmState(): HarmState {
  return {
    conditions: [],
    deathSaves: 0,
    permanentInjuries: [],
    restHours: 0,
    conditionHistory: []
  }
}

export const MAX_CONDITION_HISTORY = 20

/**
 * Append a cleared condition to the resolved-condition log. Pure — the
 * caller (worldUpdaters/characters.ts) persists the result alongside the
 * rest of HarmState. Mirrors `appendWikiChangelog`'s bounded-array shape.
 */
export function appendConditionHistory(
  existing: ResolvedCondition[],
  cleared: Condition,
  resolvedAtTurn: number
): ResolvedCondition[] {
  const entry: ResolvedCondition = {
    name: cleared.name,
    category: cleared.category,
    appliedAt: cleared.appliedAt,
    resolvedAt: resolvedAtTurn
  }
  return [...existing, entry].slice(-MAX_CONDITION_HISTORY)
}

/**
 * Read `Character.conditions` into a whole HarmState.
 *
 * The single parse boundary for that blob. It was being reimplemented at
 * every read site as `(character.conditions as any)?.conditions || []`,
 * once per field, in six files — each one independently responsible for
 * remembering that the column is nullable, that it might hold a scalar or
 * an array, and which fields live in it. `restHours` is the proof that
 * costs something: it was added for natural recovery and only two of those
 * sites know it exists.
 *
 * Degrades field by field rather than all-or-nothing. A blob with good
 * conditions and a corrupt deathSaves should cost the death saves, not a
 * character's whole condition list — the same degradation ladder the AI
 * schemas use.
 */
export function parseHarmState(value: unknown): HarmState {
  const state = createDefaultHarmState()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return state

  const raw = value as Record<string, unknown>
  if (Array.isArray(raw.conditions)) state.conditions = raw.conditions as Condition[]
  if (Array.isArray(raw.permanentInjuries)) {
    state.permanentInjuries = raw.permanentInjuries as PermanentInjury[]
  }
  if (Array.isArray(raw.conditionHistory)) {
    state.conditionHistory = raw.conditionHistory as ResolvedCondition[]
  }

  const deathSaves = Number(raw.deathSaves)
  if (Number.isFinite(deathSaves) && deathSaves >= 0) state.deathSaves = deathSaves

  const restHours = Number(raw.restHours)
  if (Number.isFinite(restHours) && restHours >= 0) state.restHours = restHours

  return state
}

/**
 * Common condition templates
 */
// rollModifier is only ever set below for a condition whose real effect is
// genuinely flat/undirected. Several are deliberately left unset instead
// of forcing a number that would misrepresent the fiction half the time:
//   - bleeding: a per-turn harm tick, not a roll modifier — that's a
//     different, still-unbuilt mechanic (see mechanicalEffect), not one
//     this fix pretends to add.
//   - enraged: genuinely bidirectional (+1 combat / -2 social) — no single
//     flat number is honest here without knowing which side a roll falls
//     on, and this file has no roll-type classification (see
//     resolution.ts's identical reasoning for excluding relationship
//     "fear" from its modifier).
//   - cursed/marked/unstable: freeform GM-adjudicated or a wholly separate
//     sub-mechanic (a 1d6 side-roll), not a flat roll penalty.
export const COMMON_CONDITIONS: Record<string, Omit<Condition, 'id' | 'appliedAt'>> = {
  // Physical Conditions
  bleeding: {
    name: 'Bleeding',
    category: 'Physical',
    description: 'Losing blood rapidly. Takes 1 harm at the start of each scene unless treated.',
    mechanicalEffect: '1 harm at the start of each scene',
    harmPerScene: 1
  },
  stunned: {
    name: 'Stunned',
    category: 'Physical',
    description: 'Dazed and disoriented.',
    mechanicalEffect: '-1 to all rolls until end of scene',
    rollModifier: -1
  },
  poisoned: {
    name: 'Poisoned',
    category: 'Physical',
    description: 'Toxins coursing through the body.',
    mechanicalEffect: '-1 to physical rolls',
    rollModifier: -1
  },
  broken_limb: {
    name: 'Broken Limb',
    category: 'Physical',
    description: 'A limb is fractured or broken.',
    // Flavor text says -2 "to rolls using that limb" — flattened to a
    // lighter -1 applied to every roll rather than -2 to only some,
    // since this engine has no per-roll "does this use the limb" signal
    // (same flat-simplification tradeoff weatherPenalty documents).
    mechanicalEffect: '-2 to rolls using that limb',
    rollModifier: -1
  },

  // Emotional Conditions
  terrified: {
    name: 'Terrified',
    category: 'Emotional',
    description: 'Overwhelmed by fear.',
    mechanicalEffect: '-2 to rolls against the source of fear',
    rollModifier: -1
  },
  enraged: {
    name: 'Enraged',
    category: 'Emotional',
    description: 'Consumed by anger.',
    // The one condition whose flavor is precisely stat-shaped, which is
    // why it gets statModifiers rather than the flattened rollModifier the
    // situational ones settle for: "combat" is hard, "social" is hot, and
    // both are exactly what the classifier already picks per action.
    mechanicalEffect: '+1 to combat rolls, -2 to social rolls',
    statModifiers: { hard: 1, hot: -2 }
  },
  despair: {
    name: 'Despair',
    category: 'Emotional',
    description: 'Lost all hope.',
    mechanicalEffect: '-1 to all rolls',
    rollModifier: -1
  },
  confused: {
    name: 'Confused',
    category: 'Emotional',
    description: 'Cannot think clearly.',
    mechanicalEffect: '-1 to investigation and planning rolls',
    rollModifier: -1
  },

  // Applied automatically by applyHarm when harm reaches 6. canAct() reads
  // this exact mechanicalEffect text, so it lives in the catalogue with
  // everything else rather than being constructed inline where the two
  // could drift apart.
  taken_out: {
    name: 'Taken Out',
    category: 'Physical',
    description: 'Unconscious, captured, or dying. Cannot act until stabilized.',
    mechanicalEffect: 'Cannot take actions'
  },

  // Special Conditions
  cursed: {
    name: 'Cursed',
    category: 'Special',
    description: 'Under a supernatural curse.',
    mechanicalEffect: 'Specific effects determined by curse'
  },
  marked: {
    name: 'Marked',
    category: 'Special',
    description: 'Marked by a powerful entity.',
    mechanicalEffect: 'Can be tracked and found by the entity'
  },
  unstable: {
    name: 'Unstable',
    category: 'Special',
    // Text was "Roll 1d6 at start of turn: 1-2 = random effect" — a die
    // this engine never rolled, against an effect table that never
    // existed. Defining one would be inventing game design rather than
    // implementing text already on the sheet, which is what the other two
    // #88 fixes do, so this says what the condition genuinely is: a
    // narrative instability the GM plays, with no number behind it. The
    // condition itself is untouched and still applies.
    description: 'Reality warps around you, unpredictably and without warning.',
    mechanicalEffect: 'The GM may twist any scene you are in — no fixed rule'
  }
}

/**
 * Harm a character's conditions inflict at the start of a scene (#88).
 *
 * Pure. Summed across every active condition, then clamped by the caller
 * against RECURRING_HARM_CEILING.
 */
export function recurringHarmForScene(conditions: Condition[] | null | undefined): number {
  if (!Array.isArray(conditions)) return 0
  return conditions.reduce((sum, c) => {
    const amount = Number(c?.harmPerScene)
    if (!Number.isFinite(amount) || amount <= 0) return sum
    return sum + Math.trunc(amount)
  }, 0)
}

/**
 * The highest harm recurring conditions may drive a character to on their
 * own: Impaired, never Taken Out.
 *
 * A condition ticking between scenes must not kill someone while nobody is
 * looking. Taken Out is resolved by a server-side recovery roll during
 * scene resolution — a real moment, narrated, with the death-save path
 * behind it — and bleeding out in the gap before a scene starts has no
 * such moment. So Bleeding can carry a character to the edge and hold them
 * there; finishing them is the fiction's job, not a background tick's.
 */
export const RECURRING_HARM_CEILING = 5

/**
 * Apply a scene's recurring harm to a starting harm value. Pure.
 * Returns the new harm and how much was actually dealt (which is less than
 * requested once the ceiling bites, and zero for anyone already past it).
 */
export function applyRecurringHarm(
  currentHarm: number,
  recurring: number
): { newHarm: number; dealt: number } {
  const start = Math.max(0, Math.min(6, Math.trunc(Number(currentHarm) || 0)))
  if (recurring <= 0 || start >= RECURRING_HARM_CEILING) return { newHarm: start, dealt: 0 }
  const newHarm = Math.min(RECURRING_HARM_CEILING, start + recurring)
  return { newHarm, dealt: newHarm - start }
}

/**
 * Per-stat modifier from active conditions, for the stat this roll uses
 * (#88). Pure; summed, then bounded on the same scale conditionPenalty
 * uses so a stack of conditions can't invert a roll outright.
 *
 * Unlike conditionPenalty this can be POSITIVE — Enraged genuinely helps
 * you hit someone. That's the point of the field: a condition with real
 * upside and real downside was previously enforced as neither.
 */
export const CONDITION_STAT_MOD_BOUND = 2

export function conditionStatModifier(
  conditions: Condition[] | null | undefined,
  statKey: string
): number {
  if (!Array.isArray(conditions)) return 0
  const total = conditions.reduce((sum, c) => {
    const mods = c?.statModifiers
    if (!mods || typeof mods !== 'object') return sum
    const value = Number((mods as Record<string, unknown>)[statKey])
    return Number.isFinite(value) ? sum + value : sum
  }, 0)
  return Math.max(-CONDITION_STAT_MOD_BOUND, Math.min(CONDITION_STAT_MOD_BOUND, total))
}

/**
 * Look up a stock condition by the NAME the fiction used.
 *
 * COMMON_CONDITIONS existed as a catalogue with no production consumer at
 * all: nothing ever instantiated it, and applyHarm builds its one auto
 * condition ("Taken Out") inline. So the catalogue's carefully-specified
 * effects — Bleeding's harm per scene, Enraged's stat split — were only
 * ever true of a table nobody read. A narrator writing "Bleeding" got
 * whatever fields it happened to report, and usually reported none.
 *
 * This is what makes the catalogue authoritative for names it knows.
 * Matching is on the display name rather than the key, because the name is
 * what the AI actually writes.
 */
export function findConditionTemplate(
  name: string | null | undefined
): Omit<Condition, 'id' | 'appliedAt'> | null {
  const wanted = (name || '').trim().toLowerCase()
  if (!wanted) return null
  for (const template of Object.values(COMMON_CONDITIONS)) {
    if (template.name.toLowerCase() === wanted) return template
  }
  return null
}

/**
 * Fill in a reported condition's ENFORCED fields from the stock catalogue,
 * where the report left them out.
 *
 * Reported values always win — a narrator that deliberately writes a
 * nastier Bleeding keeps it. The catalogue only supplies what wasn't said,
 * which is the common case and the whole reason those entries exist.
 *
 * Pure. Returns the condition unchanged when the name matches nothing,
 * which is every condition the fiction invents.
 */
type EnforcedConditionFields = Pick<
  Condition,
  'rollModifier' | 'harmPerScene' | 'statModifiers' | 'mechanicalEffect'
>

export function applyConditionTemplate<T extends { name: string } & Partial<EnforcedConditionFields>>(
  reported: T
): T & EnforcedConditionFields {
  const template = findConditionTemplate(reported.name)
  if (!template) return reported
  return {
    ...reported,
    rollModifier: reported.rollModifier ?? template.rollModifier,
    harmPerScene: reported.harmPerScene ?? template.harmPerScene,
    statModifiers: reported.statModifiers ?? template.statModifiers,
    // Text too: a bare "Bleeding" should read on the sheet the way the
    // catalogue describes it rather than as whatever half-sentence the
    // narrator supplied, or nothing at all.
    mechanicalEffect: reported.mechanicalEffect || template.mechanicalEffect,
  }
}

/**
 * Create a condition from a template
 */
export function createConditionFromTemplate(
  templateKey: keyof typeof COMMON_CONDITIONS,
  turnNumber?: number
): Condition {
  const template = COMMON_CONDITIONS[templateKey]
  return {
    id: `${templateKey}_${Date.now()}`,
    ...template,
    appliedAt: turnNumber
  }
}

/**
 * Death save mechanics
 * When at 6 harm, character must make death saves
 */
export function makeDeathSave(
  currentDeathSaves: number,
  success: boolean
): {
  newDeathSaves: number
  status: 'stable' | 'dying' | 'dead'
  message: string
} {
  let newDeathSaves = currentDeathSaves

  if (success) {
    newDeathSaves = Math.max(0, currentDeathSaves - 1)
    if (newDeathSaves === 0) {
      return {
        newDeathSaves,
        status: 'stable',
        message: 'Death save succeeded! Character stabilizes.'
      }
    }
    return {
      newDeathSaves,
      status: 'dying',
      message: `Death save succeeded. ${newDeathSaves} more needed to stabilize.`
    }
  } else {
    newDeathSaves = currentDeathSaves + 1
    if (newDeathSaves >= 3) {
      return {
        newDeathSaves,
        status: 'dead',
        message: 'Death save failed. Character dies.'
      }
    }
    return {
      newDeathSaves,
      status: 'dying',
      message: `Death save failed. ${3 - newDeathSaves} failures until death.`
    }
  }
}

/**
 * Is this blob already a well-formed HarmState?
 *
 * Strict where parseHarmState is forgiving, and that split is the point:
 * parse is what production reads through, so it repairs; this reports
 * whether a repair was needed. Used to log blobs that came back malformed
 * rather than fixing them in silence forever.
 *
 * It previously required a `currentHarm` between 0 and 6, a field this
 * blob has never held — so it returned false for every row ever written.
 * Nothing called it, so nothing noticed.
 */
export function validateHarmState(state: unknown): state is HarmState {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false

  const raw = state as Record<string, unknown>
  if (!Array.isArray(raw.conditions)) return false
  if (!Array.isArray(raw.permanentInjuries)) return false
  if (typeof raw.deathSaves !== 'number' || !Number.isFinite(raw.deathSaves) || raw.deathSaves < 0) {
    return false
  }
  if (typeof raw.restHours !== 'number' || !Number.isFinite(raw.restHours) || raw.restHours < 0) {
    return false
  }

  return true
}

// ============================================================================
// PHASE 12.3: DEATH AND CONSEQUENCE RULES
// ============================================================================

/**
 * Permanent Injury
 * These are lasting effects from being Taken Out
 */
export interface PermanentInjury {
  id: string
  name: string
  description: string
  mechanicalEffect: string
  acquiredAt: number // Turn number
  circumstances: string // How it happened
}

/**
 * Common permanent injuries
 */
export const PERMANENT_INJURIES: Record<string, Omit<PermanentInjury, 'id' | 'acquiredAt' | 'circumstances'>> = {
  scarred: {
    name: 'Scarred',
    description: 'Permanent scars from grievous wounds',
    mechanicalEffect: 'Intimidating appearance, -1 to charm rolls but +1 to intimidate'
  },
  bad_leg: {
    name: 'Bad Leg',
    description: 'Permanent limp from severe injury',
    mechanicalEffect: '-1 to rolls involving running, jumping, or athletic movement'
  },
  one_eye: {
    name: 'Lost Eye',
    description: 'Lost an eye in combat',
    mechanicalEffect: '-1 to ranged attacks and perception rolls involving sight'
  },
  chronic_pain: {
    name: 'Chronic Pain',
    description: 'Lingering pain from untreated wounds',
    mechanicalEffect: 'Start each scene with 1 harm unless rested'
  },
  weak_lung: {
    name: 'Weak Lung',
    description: 'Breathing difficulties from chest trauma',
    mechanicalEffect: '-1 to endurance rolls, limited stamina'
  },
  shaky_hands: {
    name: 'Shaky Hands',
    description: 'Tremors from nerve damage',
    mechanicalEffect: '-1 to delicate tasks requiring steady hands'
  },
  ptsd: {
    name: 'PTSD',
    description: 'Psychological trauma from near-death experience',
    mechanicalEffect: 'When facing similar danger, roll to keep cool or freeze up'
  }
}

/**
 * Recovery Options
 * What can happen when a character is Taken Out
 */
export type RecoveryOutcome =
  | 'stabilized'           // Recovers with no lasting effects
  | 'permanent_injury'     // Recovers but gains a permanent injury
  | 'captured'             // Taken prisoner
  | 'heroic_sacrifice'     // Character chooses to die dramatically
  | 'dead'                 // Character dies

/**
 * Recovery Roll Result
 */
export interface RecoveryRollResult {
  outcome: RecoveryOutcome
  permanentInjury?: PermanentInjury
  message: string
  newHarm: HarmLevel
}

/**
 * Perform a recovery roll when Taken Out
 * This determines if a character survives and what consequences they face
 *
 * @param rollResult - Result of the recovery roll (typically 2d6 + modifiers)
 * @param circumstances - Description of how they were taken out
 * @param turnNumber - Current turn number
 * @param rng - #213: injectable RNG for the permanent-injury pick below,
 *   same seam resolution.ts's dice engine uses. Defaults to Math.random so
 *   every existing caller behaves identically; tests can inject a
 *   deterministic one instead of globally mocking Math.random.
 * @returns Recovery outcome and any permanent injuries
 */
export function performRecoveryRoll(
  rollResult: number,
  circumstances: string,
  turnNumber: number,
  rng: Rng = Math.random
): RecoveryRollResult {
  // 10+: Stabilized with no lasting effects
  if (rollResult >= 10) {
    return {
      outcome: 'stabilized',
      message: 'You pull through remarkably well. Reduce harm to 4.',
      newHarm: 4
    }
  }

  // 7-9: Stabilized but with a permanent injury
  if (rollResult >= 7) {
    // Choose a random permanent injury
    const injuryKeys = Object.keys(PERMANENT_INJURIES)
    const randomKey = injuryKeys[Math.floor(rng() * injuryKeys.length)]
    const injuryTemplate = PERMANENT_INJURIES[randomKey as keyof typeof PERMANENT_INJURIES]

    const injury: PermanentInjury = {
      id: `${randomKey}_${Date.now()}`,
      ...injuryTemplate,
      acquiredAt: turnNumber,
      circumstances
    }

    return {
      outcome: 'permanent_injury',
      permanentInjury: injury,
      message: `You survive, but at a cost. You gain: ${injury.name}. Reduce harm to 5.`,
      newHarm: 5
    }
  }

  // 4-6: Captured or otherwise taken
  if (rollResult >= 4) {
    return {
      outcome: 'captured',
      message: 'You fall unconscious. What happens next is up to your enemies...',
      newHarm: 6
    }
  }

  // 1-3: Death's door - one more chance
  return {
    outcome: 'dead',
    message: 'You are dying. Someone must intervene immediately or you will die.',
    newHarm: 6
  }
}

/**
 * Heroic Sacrifice
 * A character chooses to die to achieve something important
 */
export interface HeroicSacrifice {
  characterId: string
  characterName: string
  turnNumber: number
  circumstances: string
  effect: string // What they accomplished
  legacy?: string // How they're remembered
}

/**
 * Perform a heroic sacrifice
 * This is a player choice, not a roll
 */
export function performHeroicSacrifice(
  characterId: string,
  characterName: string,
  circumstances: string,
  intendedEffect: string,
  turnNumber: number
): HeroicSacrifice {
  return {
    characterId,
    characterName,
    turnNumber,
    circumstances,
    effect: intendedEffect,
    legacy: `${characterName} gave their life ${circumstances}. Their sacrifice will not be forgotten.`
  }
}

/**
 * Apply medical attention
 * Reduces harm when someone tends to wounds
 */
export function applyMedicalAttention(
  currentHarm: HarmLevel,
  medicalSkill: 'basic' | 'trained' | 'expert',
  hasSupplies: boolean
): {
  newHarm: HarmLevel
  message: string
  success: boolean
} {
  // Can't heal someone at 0 harm
  if (currentHarm === 0) {
    return {
      newHarm: 0,
      message: 'No treatment needed - patient is healthy',
      success: true
    }
  }

  // Can't treat someone who is Taken Out without stabilizing first
  if (currentHarm === 6) {
    return {
      newHarm: 6,
      message: 'Patient must be stabilized before treatment can begin',
      success: false
    }
  }

  let healAmount = 0

  switch (medicalSkill) {
    case 'expert':
      healAmount = hasSupplies ? 3 : 2
      break
    case 'trained':
      healAmount = hasSupplies ? 2 : 1
      break
    case 'basic':
      healAmount = hasSupplies ? 1 : 0
      break
  }

  if (healAmount === 0) {
    return {
      newHarm: currentHarm,
      message: 'Treatment is ineffective without proper supplies',
      success: false
    }
  }

  const result = healHarm(currentHarm, healAmount)

  return {
    newHarm: result.newHarm,
    message: result.message,
    success: true
  }
}

/**
 * A deliberate stretch of rest, sourced from the fiction.
 *
 * This is the same channel as medical_attention and for the same reason:
 * when the narration says the party held up in a warm room for the night,
 * the engine decides what that is worth rather than letting the AI pick a
 * harm_healing number. `restQuality` describes the SHELTER the fiction
 * gave them — a bed and a fire, a dry cave, or a wet ditch in shifts — not
 * a difficulty the player selected. There is no rest button, by design.
 *
 * It sits between the two recovery speeds: faster than the calendar
 * (accrueNaturalRecovery, a full in-game day per point), slower than a
 * healer's hands (applyMedicalAttention, up to 3 at expert with supplies).
 *
 * Recurring-harm conditions block it, exactly as they block natural
 * recovery. Otherwise "they rest" would be a way to mend a wound that is
 * still actively bleeding, and the fiction path would quietly undo the
 * rule the time path enforces.
 */
export function applyRest(
  currentHarm: HarmLevel,
  restQuality: 'poor' | 'adequate' | 'excellent',
  conditions?: Condition[] | null
): {
  newHarm: HarmLevel
  message: string
} {
  // Can't rest if Taken Out
  if (currentHarm === 6) {
    return {
      newHarm: 6,
      message: 'Cannot rest while Taken Out - stabilization required'
    }
  }

  if (blocksNaturalRecovery(conditions)) {
    return {
      newHarm: currentHarm,
      message: 'Rest cannot mend a wound that is still open'
    }
  }

  let healAmount = 0

  switch (restQuality) {
    case 'excellent':
      healAmount = 2
      break
    case 'adequate':
      healAmount = 1
      break
    case 'poor':
      healAmount = 0
      break
  }

  if (healAmount === 0) {
    return {
      newHarm: currentHarm,
      message: 'Rest is insufficient to heal - conditions are too harsh'
    }
  }

  const result = healHarm(currentHarm, healAmount)

  return {
    newHarm: result.newHarm,
    message: `After resting, ${result.message.toLowerCase()}`
  }
}

// ---------------------------------------------------------------------------
// Natural recovery — harm healing as in-game time passes
// ---------------------------------------------------------------------------
//
// The design decision this implements: recovery happens through the fiction
// and through TIME, never through a "rest" button. In-fiction events reduce
// harm (harm_healing, medical_attention), and beyond that a body mends on
// its own the way a real one does — slowly, and only when it is left alone
// to do it.
//
// Before this, in-game time did nothing at all. A character could carry a
// broken rib across three in-game weeks and arrive exactly as broken,
// because the only path down was the narrator explicitly reporting healing.

/**
 * In-game hours of undisturbed time per point of harm recovered.
 *
 * A full day per point. Deliberately slow: harm is a 0-6 track where 4 is
 * "Impaired", so this puts a serious injury several days from healed and
 * keeps wounds meaningful across an arc rather than evaporating between
 * scenes. Fiction remains the fast path — a healer or a potion still works
 * in a moment, which is the point of having both.
 */
export const HOURS_PER_HARM_RECOVERED = 24

/**
 * Conditions that stop a body mending on its own.
 *
 * Bleeding is the obvious one and composes exactly as it should with the
 * harm it already deals each scene (#88): you do not slowly recover from a
 * wound that is still open. Matched on the enforced field rather than on
 * the name, so any condition that deals recurring harm blocks recovery
 * automatically — including ones the fiction invents.
 */
export function blocksNaturalRecovery(conditions: Condition[] | null | undefined): boolean {
  if (!Array.isArray(conditions)) return false
  return conditions.some(c => {
    const amount = Number(c?.harmPerScene)
    return Number.isFinite(amount) && amount > 0
  })
}

export interface NaturalRecoveryResult {
  newHarm: HarmLevel
  /** Carried-over in-game hours that did not add up to a full point yet. */
  restHours: number
  healed: number
  message: string | null
}

/**
 * Accrue in-game time toward healing, and spend it when it adds up.
 *
 * Partial time is CARRIED, not discarded: exchanges advance a handful of
 * hours at a time, so rounding each one down separately would mean nobody
 * ever heals. The remainder lives alongside the rest of the harm state.
 *
 * Never touches a character who is Taken Out. At harm 6 the way back is
 * stabilization and a recovery roll — a narrated moment — not the calendar
 * quietly undoing it, which is the same rule recurring harm follows in the
 * other direction.
 *
 * Pure.
 */
export function accrueNaturalRecovery(params: {
  harm: number
  restHours: number
  hoursElapsed: number
  conditions?: Condition[] | null
}): NaturalRecoveryResult {
  const harm = Math.max(0, Math.min(6, Math.trunc(Number(params.harm) || 0))) as HarmLevel
  const carried = Math.max(0, Number(params.restHours) || 0)
  const elapsed = Math.max(0, Number(params.hoursElapsed) || 0)

  const unchanged = (restHours: number): NaturalRecoveryResult =>
    ({ newHarm: harm, restHours, healed: 0, message: null })

  // Nothing to heal, or healing is not the mechanism that applies.
  if (harm === 0) return unchanged(0)
  if (harm >= 6) return unchanged(0)
  if (blocksNaturalRecovery(params.conditions)) return unchanged(0)

  const total = carried + elapsed
  const points = Math.floor(total / HOURS_PER_HARM_RECOVERED)
  if (points <= 0) return unchanged(total)

  const healed = Math.min(points, harm)
  const result = healHarm(harm, healed)
  return {
    newHarm: result.newHarm,
    restHours: total - healed * HOURS_PER_HARM_RECOVERED,
    healed,
    message: `Time and rest have done their work — ${result.message.toLowerCase()}`,
  }
}

/**
 * Check if a character is dying
 */
export function isDying(harm: HarmLevel, conditions: Condition[]): boolean {
  if (harm < 6) {
    return false
  }

  // Check if they have a "Stabilized" condition
  const hasStabilized = conditions.some(c =>
    c.name.toLowerCase().includes('stabilized') ||
    c.name.toLowerCase().includes('stable')
  )

  return !hasStabilized
}

/**
 * Stabilize a dying character
 * Emergency first aid to prevent death
 */
/** The condition stabilizing removes. Named so the two sides can't drift. */
export const CRITICALLY_DYING_CONDITION_NAME = 'Critically Dying'

export function stabilizeCharacter(
  conditions: Condition[],
  turnNumber: number
): {
  updatedConditions: Condition[]
  message: string
} {
  const stabilizedCondition: Condition = {
    id: `stabilized_${Date.now()}`,
    name: 'Stabilized',
    category: 'Physical',
    description: 'No longer dying, but still critically injured',
    mechanicalEffect: 'Cannot act until harm reduced below 6',
    appliedAt: turnNumber
  }

  // Stabilizing means you are no longer DYING — clearing that condition is
  // part of what the word means, and leaving it to each caller is how the
  // one caller that existed ended up doing it by hand while this function
  // quietly did not.
  const noLongerDying = conditions.filter(c => c.name !== CRITICALLY_DYING_CONDITION_NAME)
  const result = markCondition(noLongerDying, stabilizedCondition)

  return {
    updatedConditions: result.updatedConditions,
    message: 'Character is stabilized but still critically injured (harm 6)'
  }
}
