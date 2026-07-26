// src/lib/game/outcomeAdherence.ts
//
// Does the narration actually obey the roll? (#93)
//
// The engine rolls server-side, the prompt calls the outcome band BINDING,
// and until now **nothing checked**. A model could narrate a clean triumph
// on a MISS and the only artifact that disagreed was a receipt in a panel
// the player has to open. "The outcome band is a binding constraint on the
// narration" was a request, not a constraint — the single largest gap
// between what this product claims and what it enforces.
//
// The obvious approach — read `scene_text` and decide whether it "reads
// like" a miss — is not available. Prose is not classifiable that way
// without a second model call, and a check that is wrong a third of the
// time is worse than none: it would train everyone to ignore it.
//
// So instead of inferring, we **ask**. The model reports which band it
// narrated for each character (`outcome_echo`), and that declaration is
// compared against what the engine actually rolled. That is cheap,
// structured, needs no prose parsing, and catches the real failure: a model
// that misread the constraint, or quietly overrode it.
//
// What this deliberately does NOT do is change the story. It observes.
// Rewriting prose to match a band would be a worse product than a narrator
// that occasionally drifts, and blocking the turn on a mismatch would let a
// model's bookkeeping error cost a player their scene. The output is a
// measurement — which is exactly what was missing, since a thing nobody
// measures cannot be said to be enforced.

/** The three PbtA outcome bands the engine produces. */
export type OutcomeBand = 'strongHit' | 'weakHit' | 'miss'

export const OUTCOME_BANDS: OutcomeBand[] = ['strongHit', 'weakHit', 'miss']

export function isOutcomeBand(value: unknown): value is OutcomeBand {
  return typeof value === 'string' && (OUTCOME_BANDS as string[]).includes(value)
}

export type AdherenceVerdict =
  /** The narration reported the band the engine rolled. */
  | 'match'
  /** The narration reported a different band. The failure this exists for. */
  | 'mismatch'
  /** The model said nothing about this character's action. */
  | 'unreported'
  /** This character had several rolled actions; an echo cannot be attributed. */
  | 'ambiguous'

export interface AdherenceEntry {
  characterName: string
  rolled: OutcomeBand
  narrated: OutcomeBand | null
  verdict: AdherenceVerdict
}

export interface AdherenceResult {
  entries: AdherenceEntry[]
  matched: number
  /** Contradictions. The number that matters. */
  mismatched: number
  unreported: number
  ambiguous: number
  /** Human-readable lines for the resolution log; empty when all is well. */
  problems: string[]
}

/** One rolled action, as resolveActionMechanics produced it. */
export interface RolledAction {
  characterName: string
  outcome: OutcomeBand
}

/** One line of the model's self-report. */
export interface OutcomeEcho {
  character_name_or_id?: string | null
  outcome?: string | null
}

const normalize = (name: unknown): string =>
  typeof name === 'string' ? name.trim().toLowerCase() : ''

/**
 * Compare what was rolled against what the model says it narrated.
 *
 * Pure. Matches on character name because that is the handle the prompt
 * already uses for actions — no new identifier is introduced into the
 * contract just to run this check.
 *
 * A character with MORE THAN ONE rolled action this exchange is reported
 * `ambiguous` rather than guessed at: with a single name-keyed echo there
 * is no honest way to say which action it refers to, and a check that
 * invents an attribution would generate exactly the false alarms that get
 * checks switched off.
 *
 * A missing echo is `unreported`, not a mismatch — failing to answer is not
 * the same as contradicting. It is still counted and surfaced, because
 * otherwise silence would be a way to dodge the check entirely.
 */
export function checkOutcomeAdherence(
  rolled: RolledAction[],
  echoes: unknown
): AdherenceResult {
  const actions = Array.isArray(rolled) ? rolled.filter(a => isOutcomeBand(a?.outcome)) : []

  const echoByName = new Map<string, OutcomeBand>()
  if (Array.isArray(echoes)) {
    for (const echo of echoes as OutcomeEcho[]) {
      const key = normalize(echo?.character_name_or_id)
      if (!key || !isOutcomeBand(echo?.outcome)) continue
      // First report wins: a model contradicting itself about one character
      // should not have the later line silently overwrite the earlier.
      if (!echoByName.has(key)) echoByName.set(key, echo.outcome as OutcomeBand)
    }
  }

  const actionCountByName = new Map<string, number>()
  for (const action of actions) {
    const key = normalize(action.characterName)
    actionCountByName.set(key, (actionCountByName.get(key) ?? 0) + 1)
  }

  const entries: AdherenceEntry[] = []
  const problems: string[] = []

  for (const action of actions) {
    const key = normalize(action.characterName)

    if ((actionCountByName.get(key) ?? 0) > 1) {
      entries.push({
        characterName: action.characterName,
        rolled: action.outcome,
        narrated: null,
        verdict: 'ambiguous',
      })
      continue
    }

    const narrated = echoByName.get(key) ?? null
    if (!narrated) {
      entries.push({ characterName: action.characterName, rolled: action.outcome, narrated: null, verdict: 'unreported' })
      continue
    }

    const verdict: AdherenceVerdict = narrated === action.outcome ? 'match' : 'mismatch'
    entries.push({ characterName: action.characterName, rolled: action.outcome, narrated, verdict })

    if (verdict === 'mismatch') {
      problems.push(
        `${action.characterName}: engine rolled ${action.outcome}, narration reported ${narrated}`
      )
    }
  }

  const count = (v: AdherenceVerdict) => entries.filter(e => e.verdict === v).length

  return {
    entries,
    matched: count('match'),
    mismatched: count('mismatch'),
    unreported: count('unreported'),
    ambiguous: count('ambiguous'),
    problems,
  }
}
