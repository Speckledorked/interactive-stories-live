import { openaiFetch } from '@/lib/ai/openaiCompat'
import { ActionClassificationResponseSchema, ActionClassificationSchema } from '@/lib/ai/schema'
import { delimitPlayerText, PLAYER_TEXT_PROMPT_RULE } from '@/lib/ai/playerText'
// src/lib/game/resolution.ts
// The mechanical spine: server-rolled PbtA move resolution.
//
// Before the AI GM narrates an exchange, each pending player action is
// classified to a basic move (or no_roll for pure dialogue/description), a
// 2d6+modifier roll happens HERE — never in the model — and the outcome
// band (strong hit / weak hit / miss) is handed to the narrator as a
// binding constraint. The AI decides *how* it happened; the dice decide
// *how well*.
//
// Presentation philosophy (deliberate, see the knowledge-relative-sheet
// work): mechanics stay under the hood. Prose never mentions dice or
// moves; roll receipts are stored per scene and rendered only in the
// opt-in transparency panel, so skeptics can verify the game is fair
// without the surface feeling gamified.
//
// Everything fails open: if classification errors or a character can't be
// matched, the action simply resolves freeform, exactly as before this
// system existed.

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { BASIC_MOVES, calculateOutcome } from '@/lib/pbta-moves'
import { MAX_CORRUPTION, CORRUPTION_SURGE_BONUS, hasCorruptionTheme } from './corruption'
import { proficiencyBand, ProficiencyBand } from './capabilities'
import { effectiveStandingModifier } from './standing'
import { checkCorruptionGate } from './corruptionGates'
import { conditionStatModifier } from './harm'
import { reflectedRapportModifier, describeReflectedRapport } from './socialTies'
import { debtModifier, debtsWithCounterparty, describeDebtLeverage, DebtsForRoll } from './debts'
import {
  ZonePosition,
  Engagement,
  rangeModifier,
  resolveZoneForScene,
  isEngagement,
  isZonePosition,
  describeZone,
  parseZone,
  DEFAULT_ZONE,
} from './zones'
import { AI_MODELS } from '@/lib/ai/models'
import { recordAICost, estimateTokenCount } from '@/lib/ai/cost-tracker'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionClassification {
  action_index: number
  move_name: string // one of BASIC_MOVES names, or "no_roll"
  stat_key: string // cool | hard | hot | sharp | weird
  capability_key: string | null // relevant capability name, if any
  // Faction whose regard is in play for social/political leverage —
  // standing with it modifies the roll (see lib/game/standing.ts).
  faction_name: string | null
  // A specific NPC whose personal opinion of the character is in play —
  // distinct from faction_name (an institution's regard vs. one person's).
  // Modifies the roll from Character.relationships (trust/tension/respect),
  // set by relationship_changes in stateUpdater.ts. Optional/null when the
  // action isn't leaning on a specific relationship.
  npc_name?: string | null
  // True when this action invokes the character's open corruption bargain
  // (see lib/game/corruption.ts) — grants the surge bonus at roll time.
  // Optional: absent means false.
  accepts_bargain?: boolean
  // The id of a listed perk/signature-ability whose trigger the classifier
  // judged this action clearly matches, or null. Perks ("+1 forward when
  // you have time to prepare") and earned Abilities
  // (organic_advancement.new_moves' trigger text) are both situational —
  // there's no deterministic way to tell whether THIS action qualifies
  // without asking something that can read the fiction, so this reuses
  // the same classifier that already reads capability_key/faction_name/
  // npc_name off the action text (see SignatureForRoll below). computeMechanics
  // never trusts this id blindly — it's re-checked against the acting
  // character's actual perks/moves before any bonus applies.
  matched_signature_id?: string | null
  // How this action reaches its target: 'melee' (bodily, at arm's length),
  // 'ranged' (a weapon/effect crossing distance), 'social' (aimed at a
  // person's mind), or null for anything that isn't reaching for a target
  // at all — which is most actions. Priced against the character's range
  // band by rangeModifier (lib/game/zones.ts). Read from the fiction here
  // for the same reason capability_key is: deciding melee-vs-ranged from a
  // move's NAME would be keyword guesswork.
  engagement?: 'melee' | 'ranged' | 'social' | null
  // Set only when the action text itself repositions the character ("she
  // charges the line", "he backs into the alley mouth"). Null — the normal
  // case — means they stay in the band they were already in. Reporting a
  // transition is a reading of the fiction; the modifier that transition
  // earns is decided by the code.
  moves_to_zone?: 'close' | 'near' | 'far' | 'distant' | null
}

export interface ActionMechanics {
  actionId: string
  characterId: string
  characterName: string
  moveName: string
  statKey: string
  statMod: number
  capabilityName: string | null
  capabilityMod: number
  factionName: string | null
  standingMod: number
  npcName: string | null
  relationshipMod: number
  weatherCondition: string | null
  weatherMod: number
  // Whether the acting character's location is contested (see
  // contestedPenalty) and what that cost them.
  isContestedLocation: boolean
  contestedMod: number
  // #109: the acting character's location's physical/social condition (see
  // tick/locationConditionTick.ts), and what that was worth. Named
  // distinctly from conditionMod/conditionStatMod below — those are the
  // CHARACTER's status effects, this is the LOCATION's.
  siteConditionMod: number
  harmPenalty: number
  // Sum of active conditions' rollModifier (see conditionPenalty below).
  conditionMod: number
  // Stat-shaped condition effects for THIS roll's stat (#88). Unlike
  // conditionMod this may be positive.
  conditionStatMod: number
  // Name of the perk/signature-ability the classifier matched to this
  // action, if any — for display alongside signatureMod.
  signatureName: string | null
  // SIGNATURE_BONUS when a listed perk/ability's trigger matched, else 0.
  signatureMod: number
  // What this NPC's allies and rivals think of the character, echoing onto
  // their own regard (#89). Capped at ±1 against relationshipMod's ±2 —
  // an echo, never the thing itself.
  reflectedMod: number
  // Outstanding debts with whichever counterparty this roll named, and
  // what that ledger was worth — see debtModifier in lib/game/debts.ts.
  debtCounterparty: string | null
  debtMod: number
  // Range band this character acted from, and how the action reached — see
  // lib/game/zones.ts. zoneMod is what the pairing was worth.
  zonePosition: ZonePosition
  engagement: Engagement
  zoneMod: number
  // CORRUPTION_SURGE_BONUS when this roll invoked an open bargain, else 0.
  // A non-zero value is also the signal that a mark MUST land this scene
  // (see ensureSurgeCorruptionChanges in corruption.ts).
  corruptionSurgeBonus: number
  dice: [number, number]
  total: number
  outcome: 'strongHit' | 'weakHit' | 'miss'
  outcomeText: string // the move's band text — what this outcome MEANS
}

// #213: Rng/rollD6 now live in ./rng so harm.ts and worldUpdaters/characters.ts
// can use the same injectable RNG without importing this file (which itself
// imports from harm.ts) and creating a cycle. Re-exported here so every
// existing `from './resolution'` import keeps working unchanged.
export type { Rng } from './rng'
export { rollD6 } from './rng'
import type { Rng } from './rng'
import { rollD6 } from './rng'

// ---------------------------------------------------------------------------
// Pure mechanics
// ---------------------------------------------------------------------------

export const PBTA_STAT_KEYS = ['cool', 'hard', 'hot', 'sharp', 'weird'] as const

/**
 * How much a relevant capability shifts the roll. Urban Shadows blend:
 * your standing with a system matters as much as raw stats.
 *  - not unlocked (glimpsed or unknown): -1 — you're attempting something
 *    you don't actually know how to do
 *  - novice: 0, competent/skilled: +1, masterful: +2
 */
export function capabilityModifier(unlocked: boolean, band: ProficiencyBand): number {
  if (!unlocked) return -1
  switch (band) {
    case 'masterful': return 2
    case 'skilled':
    case 'competent': return 1
    default: return 0
  }
}

/** Existing harm rule (see the <mechanics> prompt): 4-5 harm = Impaired, -1 to rolls. */
export function harmPenalty(harm: number): number {
  return harm >= 4 ? -1 : 0
}

// A flat, undirected roll penalty summed across every active condition —
// same simplification philosophy as weatherPenalty/harmPenalty. Floored
// rather than left uncapped so a pile of conditions can't zero out (or
// invert) a roll outright; -3 already stacks with harm/weather to make a
// battered character's rolls genuinely worse without being unplayable.
// Only conditions with a real (non-directional) rollModifier contribute —
// see COMMON_CONDITIONS in harm.ts for which ones that is and why.
const CONDITION_PENALTY_FLOOR = -3

export function conditionPenalty(conditions: Array<{ rollModifier?: number }> | null | undefined): number {
  if (!conditions || conditions.length === 0) return 0
  const total = conditions.reduce((sum, c) => sum + (c.rollModifier || 0), 0)
  return Math.max(CONDITION_PENALTY_FLOOR, Math.min(0, total))
}

// A perk or earned Ability (organic_advancement.new_moves) offered to the
// classifier as a possible situational match for an action — see
// matched_signature_id on ActionClassification. `trigger` is what the
// classifier reads to decide relevance: a perk's own description text
// (perks don't have a separate trigger field) or an Ability's dedicated
// trigger text. id is prefixed by kind so a same-named perk and Ability
// can never collide.
export interface SignatureForRoll {
  id: string
  name: string
  trigger: string
}

// Every perk/ability read from prose is written as "+1" in its own
// flavor text — matching that number here keeps the mechanic honest to
// what players were told it does, without pretending finer-grained
// tuning exists.
export const SIGNATURE_BONUS = 1

export interface CharacterForRoll {
  id: string
  name: string
  stats: Record<string, number> | null
  harm: number
  // Corruption bargain state — only relevant in campaigns with a theme.
  corruption?: number
  pendingBargainOffer?: string | null
  capabilities: Array<{
    state: 'GLIMPSED' | 'UNLOCKED'
    proficiency: number
    framedLabel: string | null
    capability: { key: string; name: string }
  }>
  // Per-NPC/faction trust/tension/respect/fear, keyed by entity id — see
  // relationship_changes in lib/ai/client.ts and stateUpdater.ts's writer.
  // Only the NPC-keyed entries are read here (see RelationshipForRoll).
  relationships?: Record<string, { trust: number; tension: number; respect: number; fear: number }> | null
  // Conditions currently marked on this character's sheet (see harm.ts) —
  // read for conditionPenalty above.
  conditions?: Array<{
    rollModifier?: number
    // Per-stat modifiers (#88) — see conditionStatModifier in harm.ts.
    statModifiers?: Partial<Record<string, number>>
  }> | null
  // This character's perks + earned Abilities, offered to the classifier
  // as possible situational matches — see SignatureForRoll.
  signatures?: SignatureForRoll[]
  // Range band carried in from the last action, and the metadata that
  // scopes it to a scene. Resolved by resolveZoneForScene, not read raw —
  // a zone stored under a different scene is stale. See zones.ts.
  currentZone?: unknown
  zoneMetadata?: unknown
}

// The faction side of a roll, resolved by the orchestrator from the
// classifier's faction_name against LIVE simulation state — this is where
// the offscreen tick reaches into the dice.
export interface FactionForRoll {
  name: string
  isActive: boolean
  influence: number
  standing: number // this character's standing value, 0 if no row
}

// The NPC-relationship side of a roll — parallel to FactionForRoll, but for
// one person's regard rather than an institution's. trust/tension/respect
// are net socially (goodwill vs. friction); fear is deliberately excluded
// from the modifier below since it cuts both ways depending on the move
// (an asset for intimidation, a liability for persuasion) and the
// classifier doesn't currently signal which — safer to leave it purely
// narrative than to guess wrong on a mechanical bonus.
export interface RelationshipForRoll {
  npcName: string
  trust: number
  tension: number
  respect: number
  // How this NPC's own allies and rivals color their view of the character
  // (#89) — resolved by the orchestrator from NPC.socialTies against the
  // character's existing rapport with those third parties. See
  // lib/game/socialTies.ts. Absent means no ties on record.
  reflected?: number
}

/**
 * How much a personal relationship shifts a roll. Same banding philosophy
 * as effectiveStandingModifier (lib/game/standing.ts): a single deterministic
 * scalar, capped at ±2 so it stays in line with the other modifiers. Net
 * goodwill (trust + respect - tension, each -100..100) scaled down by 50 —
 * a maxed-out warm relationship (trust 100, respect 100, tension 0) hits the
 * +2 cap; a maxed-out hostile one (tension 100, trust/respect 0) hits -2.
 */
export function relationshipModifier(rel: RelationshipForRoll | null | undefined): number {
  if (!rel) return 0
  const netGoodwill = rel.trust + rel.respect - rel.tension
  return Math.max(-2, Math.min(2, Math.round(netGoodwill / 50)))
}

// The weather side of a roll — resolved by the orchestrator from the
// acting character's currentLocation against the deterministic world tick's
// live weather state (see lib/game/tick/weatherTick.ts). condition is the
// raw WeatherCondition enum value (CLEAR/CLOUDY/RAIN/STORM/SNOW/FOG).
export interface WeatherForRoll {
  condition: string
  severity: number
}

const BENIGN_WEATHER_CONDITIONS = new Set(['CLEAR', 'CLOUDY'])
const SEVERE_WEATHER_SEVERITY_THRESHOLD = 4

/**
 * How much harsh weather shifts a roll — a flat Impaired-style penalty
 * (same magnitude and philosophy as harmPenalty above), not a per-move
 * judgment call about which moves weather "should" affect. Deciding that
 * from a move name would be exactly the kind of keyword-classification
 * guesswork this codebase avoids everywhere else (see the audit note on
 * ComplexExchangeResolver) — a flat, universal penalty when conditions are
 * genuinely bad is simpler and no less honest. CLEAR/CLOUDY never penalize
 * regardless of severity; anything else only bites at severity 4+, the
 * same bar weatherTick.ts's own SEVERE_CONDITIONS uses for MAJOR-worthy
 * weather history entries.
 */
export function weatherPenalty(weather: WeatherForRoll | null | undefined): number {
  if (!weather) return 0
  if (BENIGN_WEATHER_CONDITIONS.has(weather.condition)) return 0
  return weather.severity >= SEVERE_WEATHER_SEVERITY_THRESHOLD ? -1 : 0
}

/**
 * How much acting inside contested territory shifts a roll.
 *
 * Location.isContested was previously written by the tick (a rival has
 * moved against a place but hasn't taken it yet) and read by nothing
 * mechanical — territory changed hands with no consequence for anyone
 * standing on it, which made the whole war/expansion layer invisible to
 * players except as narration. This is the same shape of fix weather
 * already got: a flat, universal penalty rather than a per-move judgment
 * about which actions contested ground "should" affect, since deciding
 * that from a move name is the keyword guesswork this codebase avoids.
 *
 * A contested location is one with hostile patrols, disrupted trade and
 * nobody sure who's in charge — everything is harder there, not just
 * fighting. Magnitude matches harm/weather (-1) so it composes with them
 * predictably instead of introducing a new scale.
 */
export function contestedPenalty(isContested: boolean | null | undefined): number {
  return isContested ? -1 : 0
}

const SITE_CONDITION_PENALTY_THRESHOLD = 25 // RUINED/ABANDONED band (see locationConditionTick.ts)
const SITE_CONDITION_BONUS_THRESHOLD = 75 // PROSPEROUS band

/**
 * How a location's physical/social condition (Location.conditionScore, see
 * tick/locationConditionTick.ts) shifts a roll made there. Same flat,
 * universal shape as weatherPenalty/contestedPenalty — a half-ruined,
 * fought-over place makes everything harder, not just specific actions; a
 * thriving one makes things a little easier. A missing score (a location
 * predating this column, or none at all) is treated as neutral rather than
 * guessed at.
 */
export function locationConditionPenalty(conditionScore: number | null | undefined): number {
  if (conditionScore === null || conditionScore === undefined) return 0
  if (conditionScore < SITE_CONDITION_PENALTY_THRESHOLD) return -1
  if (conditionScore >= SITE_CONDITION_BONUS_THRESHOLD) return 1
  return 0
}

// Per-campaign display override for a canonical move (Move.baseMoveKey,
// generated by lib/ai/moveFlavor.ts) — name/outcome text ONLY. Mechanics
// (stat, rollType, which band a total lands in) always come from the fixed
// BASIC_MOVES entry; flavor never participates in the math below.
export interface MoveFlavorForRoll {
  name: string
  outcomes: {
    strongHit?: string
    weakHit?: string
    miss?: string
  }
}

// #201: Move.outcomes is an untyped Json column, and campaign-exporter.ts's
// importMoves writes it straight from a campaign-export file with no
// validation — a corrupted or hand-edited export can plant a row whose
// outcomes isn't even an object (null, a string, an array...). Reused at
// both the write boundary (importMoves) and the read boundary below, so a
// malformed row degrades to "no flavor for that band" instead of throwing
// and silently dropping dice mechanics for the whole exchange.
export function sanitizeMoveOutcomes(raw: unknown): MoveFlavorForRoll['outcomes'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const outcomes: MoveFlavorForRoll['outcomes'] = {}
  if (typeof o.strongHit === 'string') outcomes.strongHit = o.strongHit
  if (typeof o.weakHit === 'string') outcomes.weakHit = o.weakHit
  if (typeof o.miss === 'string') outcomes.miss = o.miss
  return outcomes
}

/**
 * Roll one classified action. Pure given an injected RNG.
 * Returns null for no_roll classifications or unknown moves.
 */
/**
 * Everything a roll consults beyond the character and the classification —
 * all of it optional, all of it degrading to "no effect" when absent.
 *
 * A named object rather than a tail of positional parameters: this list has
 * grown to six as modifiers were added, and callers had reached
 * `null, null, null, null, null` before the one argument they cared about.
 * That is a defect waiting to happen — two adjacent nullable params of the
 * same type would swap silently — and it already misled one call site.
 */
export interface RollContext {
  faction?: FactionForRoll | null
  relationship?: RelationshipForRoll | null
  /** Outstanding debts with the counterparty this action named, if any. */
  debts?: DebtsForRoll | null
  weather?: WeatherForRoll | null
  moveFlavor?: MoveFlavorForRoll | null
  isContestedLocation?: boolean | null
  /** #109 — see locationConditionPenalty. */
  locationConditionScore?: number | null
  /**
   * The scene this roll belongs to. Required for a zone to count at all:
   * resolveZoneForScene discards a stored position from a different scene,
   * so omitting it means every character rolls from DEFAULT_ZONE, which
   * modifies nothing. That's the correct degradation for a caller that
   * doesn't track positions.
   */
  sceneId?: string | null
}

export function computeMechanics(
  classification: ActionClassification,
  action: { id: string },
  character: CharacterForRoll,
  rng: Rng,
  context: RollContext = {}
): ActionMechanics | null {
  const { faction, relationship, debts, weather, moveFlavor, isContestedLocation, locationConditionScore, sceneId } = context
  if (classification.move_name === 'no_roll') return null
  const move = BASIC_MOVES.find(m => m.name === classification.move_name)
  if (!move) return null

  const statKey = PBTA_STAT_KEYS.includes(classification.stat_key as any)
    ? classification.stat_key
    : 'cool'
  const statMod = Math.max(-3, Math.min(3, Number(character.stats?.[statKey]) || 0))

  let capabilityName: string | null = null
  let capabilityMod = 0
  if (classification.capability_key) {
    const wanted = classification.capability_key.toLowerCase()
    const row = character.capabilities.find(
      r =>
        r.capability.key === wanted ||
        r.capability.name.toLowerCase() === wanted ||
        (r.framedLabel && r.framedLabel.toLowerCase() === wanted)
    )
    if (row) {
      capabilityName = row.framedLabel || row.capability.name
      capabilityMod = capabilityModifier(row.state === 'UNLOCKED', proficiencyBand(row.proficiency))
    } else {
      // The classifier says this action leans on a system the character
      // doesn't know at all — attempting the truly unknown.
      capabilityName = classification.capability_key
      capabilityMod = -1
    }
  }

  // Standing weight against live faction state: 0 for a collapsed
  // faction, capped ±1 at LOW influence, else ±2 — see standing.ts.
  let factionName: string | null = null
  let standingMod = 0
  if (faction) {
    factionName = faction.name
    standingMod = effectiveStandingModifier(faction.standing, faction.isActive, faction.influence)
  }

  // Personal relationship weight, capped ±2 — see relationshipModifier above.
  let npcName: string | null = null
  let relationshipMod = 0
  let reflectedMod = 0
  if (relationship) {
    npcName = relationship.npcName
    relationshipMod = relationshipModifier(relationship)
    // Reputation reaching this NPC through their own allies and rivals.
    reflectedMod = Math.max(-1, Math.min(1, Math.trunc(Number(relationship.reflected) || 0)))
  }

  // Corruption surge: the classifier says this action invokes the
  // character's open bargain. Only honored when a bargain is actually
  // pending and the character isn't already fully consumed.
  const corruptionSurgeBonus =
    classification.accepts_bargain &&
    character.pendingBargainOffer &&
    (character.corruption ?? 0) < MAX_CORRUPTION
      ? CORRUPTION_SURGE_BONUS
      : 0

  // Weather weight from the character's current location — flat penalty,
  // capped at -1, see weatherPenalty above.
  const weatherCondition = weather && !BENIGN_WEATHER_CONDITIONS.has(weather.condition) ? weather.condition : null
  const weatherMod = weatherPenalty(weather)

  // Contested-territory weight from the same location — see
  // contestedPenalty above.
  const contestedMod = contestedPenalty(isContestedLocation)

  // Site condition weight from the same location — see
  // locationConditionPenalty above.
  const siteConditionMod = locationConditionPenalty(locationConditionScore)

  // Debt leverage with whoever this action is aimed at: a favor they owe
  // you helps, one you owe them hurts. See debtModifier.
  const debtMod = debtModifier(debts)
  const debtCounterparty = debts && debtMod !== 0 ? describeDebtLeverage(debts, debtMod) : null

  // Range band: where this character stands vs. how the action reaches —
  // see rangeModifier in zones.ts. An explicit reposition in the action
  // text wins over the carried position; a position from another scene
  // doesn't count.
  const zonePosition = resolveZoneForScene({
    storedZone: character.currentZone,
    storedMetadata: character.zoneMetadata,
    sceneId: sceneId || '',
    movesTo: classification.moves_to_zone,
  })
  const engagement: Engagement = isEngagement(classification.engagement)
    ? classification.engagement
    : null
  const zoneMod = rangeModifier(zonePosition, engagement)

  // Active conditions' flat roll penalty — see conditionPenalty above.
  const conditionMod = conditionPenalty(character.conditions)

  // Stat-shaped condition effects (#88). Separate from conditionMod
  // because this one can be POSITIVE — Enraged genuinely helps you hit
  // someone and genuinely hurts you talking to them, and a single
  // undirected number could express neither.
  const conditionStatMod = conditionStatModifier(character.conditions as any, statKey)

  // Perk/Ability situational bonus: never trust the classifier's pick
  // blindly — re-check it against the character's actual signatures
  // first, same discipline capability_key gets above. An id the
  // character doesn't actually have (hallucinated, or granted to a
  // different character) contributes nothing.
  let signatureName: string | null = null
  let signatureMod = 0
  if (classification.matched_signature_id) {
    const matched = character.signatures?.find(s => s.id === classification.matched_signature_id)
    if (matched) {
      signatureName = matched.name
      signatureMod = SIGNATURE_BONUS
    }
  }

  const harmMod = harmPenalty(character.harm)
  const dice: [number, number] = [rollD6(rng), rollD6(rng)]
  const total = dice[0] + dice[1] + statMod + capabilityMod + standingMod + relationshipMod + reflectedMod + debtMod + weatherMod + contestedMod + siteConditionMod + zoneMod + conditionMod + conditionStatMod + signatureMod + harmMod + corruptionSurgeBonus
  const outcome = calculateOutcome(total)
  // Flavor overrides display only, and only where it actually supplied text
  // for this band — a partially-flavored move (AI omitted one outcome)
  // still falls back to the generic band text rather than showing blank.
  const outcomeText = moveFlavor?.outcomes?.[outcome] || move.outcomes[outcome] || ''

  return {
    actionId: action.id,
    characterId: character.id,
    characterName: character.name,
    moveName: moveFlavor?.name || move.name,
    statKey,
    statMod,
    capabilityName,
    capabilityMod,
    factionName,
    standingMod,
    npcName,
    relationshipMod,
    weatherCondition,
    weatherMod,
    isContestedLocation: Boolean(isContestedLocation),
    contestedMod,
    siteConditionMod,
    reflectedMod,
    debtCounterparty,
    debtMod,
    zonePosition,
    engagement,
    zoneMod,
    conditionMod,
    conditionStatMod,
    signatureName,
    signatureMod,
    harmPenalty: harmMod,
    corruptionSurgeBonus,
    dice,
    total,
    outcome,
    outcomeText,
  }
}

// ---------------------------------------------------------------------------
// AI classification (EFFICIENT model, fail-open)
// ---------------------------------------------------------------------------

const MOVE_LIST_FOR_PROMPT = BASIC_MOVES.map(m => `- "${m.name}": ${m.trigger}`).join('\n')

/**
 * #381: validate the classifier's output.
 *
 * This is the AI surface that decides every INPUT to the roll — move,
 * stat, which capability applies, which faction's standing and which NPC's
 * rapport are in play, whether a bargain was taken, where the character
 * ends up standing. computeMechanics below it is genuinely pure and pinned
 * by exact golden vectors, but honest arithmetic over dishonest inputs is
 * still a dishonest result.
 *
 * It previously had no schema: `stat_key` was accepted as any string and
 * silently became 'cool' downstream, which is a 6-point swing on a 2-12
 * scale decided by a hallucination. Now it goes through Zod like every
 * other AI output in the codebase, AND the two referential fields are
 * re-verified against the real campaign roster — a shape check cannot tell
 * you whether a faction exists.
 *
 * Still fail-open per entry: one malformed classification drops that
 * action to freeform rather than failing the whole exchange.
 */
export function parseClassifications(
  raw: any,
  actionCount: number,
  // The real rosters this campaign has. Omitted means "don't re-verify",
  // which is the right degradation for callers with no roster to check
  // against — never the live path, which always has them.
  known?: { factionNames?: string[]; npcNames?: string[] }
): ActionClassification[] {
  const parsed = ActionClassificationResponseSchema.safeParse(raw)
  if (!parsed.success) {
    // The envelope itself is wrong (not an object, classifications not an
    // array). Nothing salvageable.
    console.warn('Action classification response failed schema validation — resolving freeform:', parsed.error.issues[0]?.message)
    return []
  }

  const validMoves = new Set([...BASIC_MOVES.map(m => m.name), 'no_roll'])
  // Matched case-insensitively because that is how the prompt lists them
  // and how every other entity resolver in the codebase compares names,
  // but the value KEPT is the roster's, not the model's — downstream
  // lookups are exact.
  const factionByName = new Map((known?.factionNames ?? []).map(n => [n.toLowerCase(), n]))
  const npcByName = new Map((known?.npcNames ?? []).map(n => [n.toLowerCase(), n]))

  const out: ActionClassification[] = []
  for (const raw of parsed.data.classifications) {
    // Per entry, so one malformed classification costs that action its
    // mechanics rather than the whole exchange's.
    const entry = ActionClassificationSchema.safeParse(raw)
    if (!entry.success) {
      console.warn('Dropping a malformed action classification — that action resolves freeform:', entry.error.issues[0]?.message)
      continue
    }
    const c = entry.data
    if (c.action_index >= actionCount) continue
    if (!validMoves.has(c.move_name)) {
      console.warn(`Classifier named a move that does not exist ("${c.move_name}") — that action resolves freeform`)
      continue
    }

    // A real move needs a real stat. "no_roll" has nothing to roll, so it
    // legitimately names none — requiring one there would drop exactly the
    // classifications that carry no mechanical risk.
    if (c.move_name !== 'no_roll' && !c.stat_key) {
      console.warn(`Classifier returned "${c.move_name}" with no stat — that action resolves freeform rather than defaulting to a stat nobody chose`)
      continue
    }

    // A faction/NPC the campaign does not have is dropped, not applied.
    // These two feed standing and rapport modifiers worth ~4 and ~6 points
    // respectively; inventing one is the cheapest way to move a roll.
    let factionName = c.faction_name
    if (factionName && known?.factionNames) {
      const real = factionByName.get(factionName.toLowerCase())
      if (!real) {
        console.warn(`Classifier named faction "${factionName}", which this campaign does not have — ignored`)
      }
      factionName = real ?? null
    }
    let npcName = c.npc_name
    if (npcName && known?.npcNames) {
      const real = npcByName.get(npcName.toLowerCase())
      if (!real) {
        console.warn(`Classifier named NPC "${npcName}", which this campaign does not have — ignored`)
      }
      npcName = real ?? null
    }

    out.push({
      action_index: c.action_index,
      move_name: c.move_name,
      stat_key: c.stat_key ?? 'cool',
      capability_key: c.capability_key || null,
      faction_name: factionName,
      npc_name: npcName,
      accepts_bargain: c.accepts_bargain,
      matched_signature_id: c.matched_signature_id || null,
      engagement: isEngagement(c.engagement) ? c.engagement : null,
      moves_to_zone: isZonePosition(c.moves_to_zone) ? c.moves_to_zone : null,
    })
  }
  return out
}

async function classifyActions(
  actions: Array<{ actionText: string }>,
  characters: CharacterForRoll[],
  actionCharacterIds: string[],
  factionNames: string[],
  npcNames: string[],
  campaignId: string,
  sceneId: string
): Promise<ActionClassification[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return []

  const actionLines = actions
    .map((a, i) => {
      const character = characters.find(c => c.id === actionCharacterIds[i])
      const knownCaps = character?.capabilities
        .filter(r => r.state === 'UNLOCKED')
        .map(r => r.framedLabel || r.capability.name)
        .join(', ')
      const signatures = character?.signatures
        ?.map(s => `${s.id} (${s.name}: ${s.trigger})`)
        .join('; ')
      const band = character ? parseZone(character.currentZone) : DEFAULT_ZONE
      // #382: fenced, not quoted. A quote pair looks like a delimiter and
      // isn't one — closing the quote and continuing was the whole
      // escape. delimitPlayerText also strips the fence from the input,
      // so a player cannot emit a closing marker.
      return `${i}. ${character?.name || 'Unknown'} [currently ${band}]${knownCaps ? ` [known abilities: ${knownCaps}]` : ''}${signatures ? ` [perks/signature abilities: ${signatures}]` : ''}${character?.pendingBargainOffer ? ` [OPEN BARGAIN: ${character.pendingBargainOffer}]` : ''}\n${delimitPlayerText(a.actionText)}`
    })
    .join('\n')

  const prompt = `Classify each tabletop RPG player action to the move it triggers.

${PLAYER_TEXT_PROMPT_RULE}

MOVES:
${MOVE_LIST_FOR_PROMPT}
- "no_roll": pure dialogue, planning, observation without pressure, or trivial activity — nothing is risked, so no dice

STATS (pick the one that governs the attempt): cool (nerve/composure), hard (force/violence), hot (charm/manipulation), sharp (perception/wits), weird (the strange/supernatural).
${factionNames.length > 0 ? `\nFACTIONS in this world: ${factionNames.join(', ')}\n` : ''}${npcNames.length > 0 ? `\nNPCs in this world: ${npcNames.join(', ')}\n` : ''}
ACTIONS:
${actionLines}

Rules:
- Only classify a move when the fiction has real stakes or opposition. Default to "no_roll" when in doubt.
- capability_key: if the action leans on one of the character's listed known abilities (or clearly on a specific learnable system, even one they lack), name it; else null.
- faction_name: if the action is social/political leverage aimed at (or invoking the name/backing of) one of the listed FACTIONS — negotiating with its members, trading on its reputation, moving through its territory openly — name that faction exactly as listed; else null. Physical actions with no social dimension get null.
- npc_name: if the action is aimed at persuading, appealing to, threatening, or otherwise leveraging ONE SPECIFIC NPC's personal opinion of the character (not their faction's) — name that NPC exactly as listed; else null. An action can name a faction OR an NPC OR neither, but naming both only makes sense if the character is explicitly working an individual within their own institution.
- accepts_bargain: true ONLY if that action's line shows an [OPEN BARGAIN: ...] AND the action clearly reaches for / accepts / draws on that offered power. Refusing it, ignoring it, or doing something unrelated is false. Actions with no open bargain are always false.
- matched_signature_id: if that action's line lists [perks/signature abilities] and this action clearly and specifically matches ONE of their trigger descriptions, return that exact id; else null. Be conservative — most actions match none, and an action can match at most one. Never invent an id not listed for that character.
- engagement: how the action reaches its target. "melee" = bodily, at arm's length (a blade, a fist, a grapple). "ranged" = a weapon or effect crossing open distance (a bow, a thrown knife, a bolt of power). "social" = aimed at a person's mind (persuading, threatening, lying to, appealing to someone present). null = the action isn't reaching for a target at all (bracing a door, searching a room, holding your nerve, running). Most actions are null — do not stretch to fit one.
- moves_to_zone: the range band the action itself MOVES the character to — "close" (in among them), "near" (a step away), "far" (across the space), "distant" (out of the confrontation). Set this ONLY when the action text explicitly changes their distance (charging in, backing off, taking cover across the room). Return null when the action doesn't move them, which is most of the time — each character's current band is shown in brackets on their line and carries over on its own.

Return JSON: {"classifications": [{"action_index": 0, "move_name": "Act Under Fire", "stat_key": "cool", "capability_key": "Swordplay", "faction_name": null, "npc_name": null, "accepts_bargain": false, "matched_signature_id": null, "engagement": "melee", "moves_to_zone": null}]}`

  const startTime = Date.now()
  try {
    const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: AI_MODELS.EFFICIENT,
        messages: [
          { role: 'system', content: 'You classify RPG actions to game moves. JSON only.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
    })
    if (!response.ok) {
      console.error('Action classification API error:', response.status)
      return []
    }
    const data = await response.json()
    const content = data.choices[0].message.content
    const usage = data.usage || {}
    // Every scene-resolution turn makes this call — it needs to be in the
    // metered billing total (resolutionBilling.ts) just as much as the
    // narration call, or the classifier's real cost silently falls outside
    // what players are charged for.
    await recordAICost({
      campaignId,
      sceneId,
      model: AI_MODELS.EFFICIENT,
      requestType: 'action_classification',
      inputTokens: usage.prompt_tokens || estimateTokenCount(prompt),
      outputTokens: usage.completion_tokens || estimateTokenCount(content),
      responseTimeMs: Date.now() - startTime,
      success: true,
    }).catch(console.error)
    return parseClassifications(JSON.parse(content), actions.length, { factionNames, npcNames })
  } catch (error) {
    // Fail open: unclassified actions resolve freeform, as they always did.
    console.error('Action classification failed (failing open):', error)
    return []
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Classify + roll every pending action in an exchange, persist DiceRoll
 * receipts, and return the mechanics for prompt-building. Any failure
 * returns [] — the scene resolves freeform rather than blocking play.
 */
// #200: resolveActionMechanics used to fail open to a bare `[]` on every
// path — a scene with no pending actions, a scene whose classifier call
// failed (missing OPENAI_API_KEY, an OpenAI outage, a malformed response),
// and a genuine DB error all produced the exact same empty array, with no
// way for the caller to tell "nothing needed rolling" apart from "the dice
// engine silently didn't run." For a product whose entire mechanical
// promise is "every risky action gets a real server-side roll," that
// second case needs to be visible, not indistinguishable from the first.
export interface ActionMechanicsResult {
  mechanics: ActionMechanics[]
  // True only when pendingActions was non-empty but no mechanics came
  // back anyway — i.e. the dice engine was supposed to run and didn't.
  // False when there were simply no pending actions to roll.
  classificationUnavailable: boolean
}

export async function resolveActionMechanics(
  campaignId: string,
  sceneId: string,
  pendingActions: Array<{ id: string; characterId: string; userId: string; actionText: string }>,
  rng: Rng = Math.random
): Promise<ActionMechanicsResult> {
  if (pendingActions.length === 0) return { mechanics: [], classificationUnavailable: false }

  try {
    const [characterRows, factionRows, npcRows, locationRows, moveFlavorRows, campaignRow, debtRows] = await Promise.all([
      prisma.character.findMany({
        where: { id: { in: Array.from(new Set(pendingActions.map(a => a.characterId))) } },
        include: {
          capabilities: {
            include: { capability: { select: { key: true, name: true } } },
          },
          factionStandings: { select: { factionId: true, value: true } },
        },
      }),
      // ALL factions, active or not: standing with a collapsed faction
      // must resolve (to zero weight), not silently miss the lookup.
      prisma.faction.findMany({
        where: { campaignId },
        select: { id: true, name: true, isActive: true, influence: true, isDiscovered: true },
      }),
      // Discovered NPCs only — same fog-of-war rule as factions below: you
      // can't knowingly work a relationship with someone the party hasn't met.
      prisma.nPC.findMany({
        where: { campaignId, isDiscovered: true },
        // Corruption gate columns (#83): a repulsed NPC's rapport must not
        // modify the roll — see the leverage gate below.
        // socialTies (#89): who this NPC counts as an ally or rival, so the
        // character's rapport with those third parties can echo onto them.
        select: { id: true, name: true, minCorruption: true, maxCorruption: true, socialTies: true },
      }),
      // Live weather per location (see lib/game/tick/weatherTick.ts) —
      // matched against each acting character's locationId (falling back
      // to a currentLocation name-string match — see below) below.
      prisma.location.findMany({
        where: { campaignId },
        select: { id: true, name: true, weather: true, weatherSeverity: true, isContested: true, conditionScore: true },
      }),
      // Per-campaign move flavor (see lib/ai/moveFlavor.ts) — rows with no
      // baseMoveKey are legacy/export-only content and never matched here.
      prisma.move.findMany({
        where: { campaignId, baseMoveKey: { not: null } },
        select: { baseMoveKey: true, name: true, outcomes: true },
      }),
      // Corruption gates (#83) only apply in a universe that HAS a
      // corruption theme — a gate left on a row in a re-themed or imported
      // campaign must not silently lock content, matching how the rest of
      // the track disables itself when the theme is null.
      prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { corruptionTheme: true },
      }),
      // Every OUTSTANDING debt held by an acting character. Fetched once
      // per exchange and matched in memory, rather than a query per action
      // — same discipline the faction/NPC rosters above follow.
      //
      // #221: no `take` limit here used to mean unbounded row growth on a
      // debt-heavy campaign, even though debtModifier's OUTPUT is always
      // safely clamped to +-2. This bound is a genuine backstop, not a
      // tuned precision cap: debtsWithCounterparty needs a specific
      // counterparty's full debt count (not just "some debts exist") to
      // compute owedTo/owedBy correctly, so a small cap risked silently
      // dropping a real counterparty's rows. 300 is sized to never
      // realistically fire for the acting party in one exchange while
      // still closing the unbounded-growth pattern; orderBy keeps the
      // truncation (if it ever happens) deterministic and favor the most
      // recently incurred debts.
      prisma.debt.findMany({
        where: {
          characterId: { in: Array.from(new Set(pendingActions.map(a => a.characterId))) },
          status: 'OUTSTANDING',
        },
        select: { characterId: true, direction: true, counterpartyName: true, counterpartyId: true },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
    ])
    // #404: one predicate, one meaning — see corruption.ts.
    const campaignHasCorruptionTheme = hasCorruptionTheme(campaignRow?.corruptionTheme)
    const debtsByCharacter = new Map<string, typeof debtRows>()
    for (const row of debtRows) {
      const list = debtsByCharacter.get(row.characterId)
      if (list) list.push(row)
      else debtsByCharacter.set(row.characterId, [row])
    }
    const moveFlavorByKey = new Map(
      moveFlavorRows.map(m => [m.baseMoveKey as string, { name: m.name, outcomes: sanitizeMoveOutcomes(m.outcomes) }])
    )
    const characters: CharacterForRoll[] = characterRows.map(c => {
      const perks = ((c.perks as any) || []) as Array<{ id: string; name: string; description: string }>
      const moves = ((c.moves as any) || []) as Array<{ id: string; name: string; trigger: string }>
      const signatures: SignatureForRoll[] = [
        // A perk has no separate trigger field — its own description IS
        // the trigger text (e.g. "+1 forward when you have time to
        // prepare"). id prefixed by kind so a same-named perk and earned
        // Ability can never collide in the classifier's flat id space.
        ...perks.map(p => ({ id: `perk:${p.id}`, name: p.name, trigger: p.description })),
        ...moves.map(m => ({ id: `move:${m.id}`, name: m.name, trigger: m.trigger })),
      ]
      return {
        id: c.id,
        name: c.name,
        stats: (c.stats as Record<string, number> | null) || null,
        harm: c.harm,
        corruption: c.corruption,
        pendingBargainOffer: (c.pendingBargain as any)?.offer || null,
        capabilities: c.capabilities as any,
        relationships: (c.relationships as any) || null,
        conditions: ((c.conditions as any)?.conditions || []) as Array<{ rollModifier?: number }>,
        signatures,
        currentZone: c.currentZone,
        zoneMetadata: c.zoneMetadata,
      }
    })
    const standingsByCharacter = new Map(
      characterRows.map(c => [c.id, new Map(c.factionStandings.map(s => [s.factionId, s.value]))])
    )
    const currentLocationByCharacter = new Map(characterRows.map(c => [c.id, c.currentLocation]))
    // locationId is the stable join — resolveOrCreateLocationId keeps it
    // in sync with currentLocation on every write. The name-string map
    // stays as a fallback for a character whose locationId hasn't
    // resolved yet (see README Known Bugs P1 — Location stored as free
    // text, not an FK).
    const locationIdByCharacter = new Map(characterRows.map(c => [c.id, c.locationId]))
    const weatherByLocationId = new Map(
      locationRows.map(l => [l.id, { condition: l.weather as string, severity: l.weatherSeverity }])
    )
    const weatherByLocationName = new Map(
      locationRows.map(l => [l.name.toLowerCase(), { condition: l.weather as string, severity: l.weatherSeverity }])
    )
    // Contested state, resolved off the same id-then-name fallback weather
    // uses so both read the character's location identically.
    const contestedByLocationId = new Map(locationRows.map(l => [l.id, l.isContested]))
    const contestedByLocationName = new Map(locationRows.map(l => [l.name.toLowerCase(), l.isContested]))
    // #109: site condition, same id-then-name fallback.
    const conditionScoreByLocationId = new Map(locationRows.map(l => [l.id, l.conditionScore]))
    const conditionScoreByLocationName = new Map(locationRows.map(l => [l.name.toLowerCase(), l.conditionScore]))

    const classifications = await classifyActions(
      pendingActions,
      characters,
      pendingActions.map(a => a.characterId),
      // Only discovered, active factions are offered as classifier
      // targets — you can't knowingly trade on the name of a faction the
      // party hasn't met or one that no longer exists.
      factionRows.filter(f => f.isActive && f.isDiscovered).map(f => f.name),
      npcRows.map(n => n.name),
      campaignId,
      sceneId
    )
    if (classifications.length === 0) return { mechanics: [], classificationUnavailable: true }

    const mechanics: ActionMechanics[] = []
    for (const classification of classifications) {
      const action = pendingActions[classification.action_index]
      const character = characters.find(c => c.id === action.characterId)
      if (!character) continue

      let factionForRoll: FactionForRoll | null = null
      if (classification.faction_name) {
        const faction = factionRows.find(
          f => f.name.toLowerCase() === classification.faction_name!.toLowerCase()
        )
        if (faction) {
          factionForRoll = {
            name: faction.name,
            isActive: faction.isActive,
            influence: faction.influence,
            standing: standingsByCharacter.get(character.id)?.get(faction.id) ?? 0,
          }
        }
      }

      let relationshipForRoll: RelationshipForRoll | null = null
      if (classification.npc_name) {
        const npc = npcRows.find(n => n.name.toLowerCase() === classification.npc_name!.toLowerCase())
        const rel = npc ? character.relationships?.[npc.id] : null
        // No relationship row yet just means neutral (all zeros) — not "no
        // roll effect vs. an unknown NPC name", which is the null case below.
        if (npc) {
          // Corruption gate on LEVERAGE (#83): an NPC who is repulsed by
          // (or who requires) what the character has become gives their
          // rapport no weight. Deliberately the one gate with no lasting
          // state — nothing is written, so it stops applying the moment the
          // gate does, and it can never trap anyone.
          const gate = checkCorruptionGate(npc, character.corruption ?? 0, campaignHasCorruptionTheme)
          if (gate.allowed) {
            relationshipForRoll = {
              npcName: npc.name,
              trust: rel?.trust ?? 0,
              tension: rel?.tension ?? 0,
              respect: rel?.respect ?? 0,
              // Reputation reaching this NPC through their own society
              // (#89). Reads the character's EXISTING rapport with the
              // third parties, so nothing is written and an NPC with no
              // ties contributes nothing.
              reflected: reflectedRapportModifier(npc.socialTies, character.relationships),
            }
          } else {
            console.log(`  🌑 ${npc.name} gives ${character.name} nothing — corruption gate (${gate.refusal})`)
          }
        }
      }

      // Debt leverage (the Debt half of the economy). Whichever counterparty
      // the action named — an NPC by preference, else the faction — is who
      // the ledger is read against. An action that names neither has no
      // debt in play, which is most actions.
      let debtsForRoll: DebtsForRoll | null = null
      const debtCounterpartyEntity =
        (classification.npc_name
          ? npcRows.find(n => n.name.toLowerCase() === classification.npc_name!.toLowerCase())
          : null) ||
        (classification.faction_name
          ? factionRows.find(f => f.name.toLowerCase() === classification.faction_name!.toLowerCase())
          : null)
      if (debtCounterpartyEntity) {
        debtsForRoll = debtsWithCounterparty(
          debtsByCharacter.get(character.id) || [],
          debtCounterpartyEntity
        )
      }

      // Prefer the stable locationId join — immune to the free-text drift
      // ("the Docks" vs "The Docks District") that made the name-string
      // match silently miss a real location. Fall back to the name match
      // only for a character whose locationId hasn't resolved yet (see
      // README Known Bugs P1 — Location stored as free text, not an FK).
      const locationId = locationIdByCharacter.get(character.id)
      const currentLocation = currentLocationByCharacter.get(character.id)
      // #405: the name fallback exists for rows whose FK hasn't resolved
      // yet, and it MISSES silently on any name drift ("The Ashen Gate" vs
      // "Ashen Gate") — at which point weather, contested-location and
      // condition modifiers all quietly drop to neutral and the character
      // rolls without the penalties the fiction says apply. Log when it is
      // load-bearing, so the drift is observable instead of inferred from
      // dice that feel wrong.
      if (!locationId && currentLocation) {
        console.warn(`  ⚠️ ${character.name} has no locationId — falling back to name match on "${currentLocation}"; location roll modifiers may be missed if the name has drifted`)
      }
      const weatherForRoll: WeatherForRoll | null =
        (locationId ? weatherByLocationId.get(locationId) : undefined) ??
        (currentLocation ? weatherByLocationName.get(currentLocation.toLowerCase()) : undefined) ??
        null

      const isContestedLocation =
        (locationId ? contestedByLocationId.get(locationId) : undefined) ??
        (currentLocation ? contestedByLocationName.get(currentLocation.toLowerCase()) : undefined) ??
        false

      const locationConditionScore =
        (locationId ? conditionScoreByLocationId.get(locationId) : undefined) ??
        (currentLocation ? conditionScoreByLocationName.get(currentLocation.toLowerCase()) : undefined) ??
        null

      const move = BASIC_MOVES.find(m => m.name === classification.move_name)
      const moveFlavor = move ? moveFlavorByKey.get(move.key) ?? null : null

      const rolled = computeMechanics(classification, action, character, rng, {
        faction: factionForRoll,
        relationship: relationshipForRoll,
        debts: debtsForRoll,
        weather: weatherForRoll,
        moveFlavor,
        isContestedLocation,
        locationConditionScore,
        sceneId,
      })
      if (rolled) mechanics.push(rolled)
    }

    // Persist receipts — the auditable record behind "the game is fair".
    if (mechanics.length > 0) {
      // Created one at a time rather than with createMany, because
      // createMany does not return ids and PlayerAction.rollMade is
      // documented as "Link to DiceRoll.id if rolled" — a link that was
      // never written, so the audit trail dead-ended: an action recorded
      // that it required a roll, DiceRoll rows existed, and nothing
      // connected the two. N here is the number of actions in one
      // exchange (party-sized), and the block immediately below already
      // issues one update per action, so this is the same order of work.
      const rollIdByActionId = new Map<string, string>()
      await Promise.all(
        mechanics.map(async m => {
          const action = pendingActions.find(a => a.id === m.actionId)
          const created = await prisma.diceRoll.create({
            data: {
            campaignId,
            sceneId,
            characterId: m.characterId,
            userId: action?.userId || '',
            rollType: 'move',
            dice: m.dice,
            modifier: m.statMod + m.capabilityMod + m.standingMod + m.relationshipMod + m.reflectedMod + m.debtMod + m.weatherMod + m.contestedMod + m.siteConditionMod + m.zoneMod + m.conditionMod + m.conditionStatMod + m.signatureMod + m.harmPenalty,
            total: m.total,
            outcome: m.outcome,
            description: `${m.moveName} (+${m.statKey}${m.capabilityName ? `, ${m.capabilityName}` : ''}${m.factionName ? `, standing w/ ${m.factionName}` : ''}${m.npcName ? `, rapport w/ ${m.npcName}` : ''}${m.debtMod ? `, ${m.debtCounterparty}` : ''}${m.weatherCondition ? `, ${m.weatherCondition.toLowerCase()}` : ''}${m.contestedMod ? ', contested ground' : ''}${m.siteConditionMod ? `, ${m.siteConditionMod > 0 ? 'thriving' : 'ruined'} surroundings` : ''}${m.zoneMod ? `, ${m.engagement} ${describeZone(m.zonePosition)}` : ''}${m.conditionMod ? `, ${m.conditionMod} condition penalty` : ''}${m.signatureName ? `, ${m.signatureName}` : ''}${m.harmPenalty ? ', impaired' : ''})`,
            },
            select: { id: true },
          })
          rollIdByActionId.set(m.actionId, created.id)
        })
      )

      // Also stamp each action row with its roll — the organic advancement
      // system (applyOrganicCharacterGrowth) reads PlayerAction.rollResult
      // to accumulate statUsage, which is what makes stats grow from
      // consistent successful use. Without this write, that whole chain
      // silently never fires.
      await Promise.all(
        mechanics.map(m =>
          prisma.playerAction.update({
            where: { id: m.actionId },
            data: {
              rollResult: {
                stat: m.statKey,
                outcome: m.outcome,
                dice: m.dice,
                total: m.total,
                moveName: m.moveName,
              },
              moveUsed: m.moveName,
              rollRequired: true,
              // Completes the receipt trail: from the action, to the roll
              // that decided it, to the modifiers behind that roll.
              rollMade: rollIdByActionId.get(m.actionId) ?? null,
            },
          })
        )
      )
      // Carry each character's range band forward. Without this write the
      // position would be recomputed from nothing every action and the
      // classifier's repositions would never persist — the exact failure
      // that made the original zone system dead.
      //
      // Best-effort: positioning is a modifier, not the resolution. One
      // character acting twice in an exchange settles on their last action's
      // band, which is the same "latest wins" the fiction itself implies.
      await Promise.all(
        Array.from(new Map(mechanics.map(m => [m.characterId, m])).values()).map(m =>
          prisma.character
            .update({
              where: { id: m.characterId },
              data: {
                currentZone: m.zonePosition,
                zoneMetadata: { sceneId } as Prisma.InputJsonValue,
              },
            })
            .catch(err => console.error(`Failed to persist zone for ${m.characterName}:`, err))
        )
      )

      console.log(`🎲 Rolled ${mechanics.length} move(s): ${mechanics.map(m => `${m.characterName} ${m.moveName}=${m.outcome}`).join('; ')}`)
    }

    // A bargain is an offer for the character's NEXT action — that action
    // just happened (rolled or not), so the window closes either way. The
    // AI can always offer again later.
    const actingWithBargain = characters.filter(
      c => c.pendingBargainOffer && pendingActions.some(a => a.characterId === c.id)
    )
    if (actingWithBargain.length > 0) {
      await prisma.character.updateMany({
        where: { id: { in: actingWithBargain.map(c => c.id) } },
        data: { pendingBargain: Prisma.JsonNull },
      })
    }

    return { mechanics, classificationUnavailable: false }
  } catch (error) {
    console.error('Action mechanics failed (failing open — freeform resolution):', error)
    return { mechanics: [], classificationUnavailable: true }
  }
}

// ---------------------------------------------------------------------------
// Outcome-band selection (#115) — which single band, if any, should drive
// this exchange's narration tone/pacing instructions in scenePrompt.ts.
// ---------------------------------------------------------------------------

// Worst band wins: a miss is the highest-stakes narrative constraint — the
// "hard GM move" framing both outcomeAdherence.ts's header comment and this
// file's own <mechanical_outcomes> prompt section treat as the case that
// matters most to get right — so if ANY rolled action this exchange missed,
// the whole exchange is paced as a miss even when other actions in the same
// exchange succeeded.
const BAND_SEVERITY: Record<ActionMechanics['outcome'], number> = {
  miss: 2,
  weakHit: 1,
  strongHit: 0,
}

/**
 * Pure. Picks the single band that should drive this exchange's narration
 * pacing, or null when no roll happened this exchange (pure dialogue,
 * planning, low-stakes activity) — the same "fails open to freeform" case
 * every other consumer of ActionMechanics[] in this file already handles.
 */
export function selectPrimaryOutcomeBand(actionMechanics: ActionMechanics[]): ActionMechanics['outcome'] | null {
  if (!Array.isArray(actionMechanics) || actionMechanics.length === 0) return null
  return actionMechanics.reduce(
    (worst, m) => (BAND_SEVERITY[m.outcome] > BAND_SEVERITY[worst] ? m.outcome : worst),
    actionMechanics[0].outcome
  )
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function describeOutcomeBand(outcome: ActionMechanics['outcome']): string {
  switch (outcome) {
    case 'strongHit': return 'STRONG HIT (they succeed cleanly)'
    case 'weakHit': return 'WEAK HIT (they succeed with a cost, complication, or hard choice)'
    case 'miss': return 'MISS (it goes wrong — make a hard GM move against them)'
  }
}

/** Receipt line for the transparency panel — the only place numbers surface. */
export function formatRollReceipt(m: ActionMechanics): string {
  const mods = [
    `${m.statMod >= 0 ? '+' : ''}${m.statMod} ${m.statKey}`,
    ...(m.capabilityName ? [`${m.capabilityMod >= 0 ? '+' : ''}${m.capabilityMod} ${m.capabilityName}`] : []),
    ...(m.factionName ? [`${m.standingMod >= 0 ? '+' : ''}${m.standingMod} standing (${m.factionName})`] : []),
    ...(m.npcName ? [`${m.relationshipMod >= 0 ? '+' : ''}${m.relationshipMod} rapport (${m.npcName})`] : []),
    ...(m.weatherCondition ? [`${m.weatherMod} ${m.weatherCondition.toLowerCase()}`] : []),
    ...(m.reflectedMod ? [`${m.reflectedMod >= 0 ? '+' : ''}${m.reflectedMod} ${describeReflectedRapport(m.reflectedMod)}`] : []),
    ...(m.debtMod ? [`${m.debtMod >= 0 ? '+' : ''}${m.debtMod} ${m.debtCounterparty}`] : []),
    ...(m.conditionStatMod ? [`${m.conditionStatMod >= 0 ? '+' : ''}${m.conditionStatMod} condition (${m.statKey})`] : []),
    ...(m.contestedMod ? [`${m.contestedMod} contested ground`] : []),
    ...(m.siteConditionMod ? [`${m.siteConditionMod >= 0 ? '+' : ''}${m.siteConditionMod} ${m.siteConditionMod > 0 ? 'thriving' : 'ruined'} surroundings`] : []),
    ...(m.zoneMod ? [`${m.zoneMod >= 0 ? '+' : ''}${m.zoneMod} ${m.engagement} range (${describeZone(m.zonePosition)})`] : []),
    ...(m.harmPenalty ? [`${m.harmPenalty} impaired`] : []),
    ...(m.corruptionSurgeBonus ? [`+${m.corruptionSurgeBonus} corruption surge (bargain accepted)`] : []),
  ].join(', ')
  const band = m.outcome === 'strongHit' ? 'strong hit' : m.outcome === 'weakHit' ? 'weak hit' : 'miss'
  return `${m.moveName}: 2d6 (${m.dice[0]}+${m.dice[1]}) ${mods} = ${m.total} — ${band}`
}
