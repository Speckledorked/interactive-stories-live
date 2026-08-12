// src/lib/game/moveVariety.ts
//
// #232: outcome-band move selection (the WEAK HIT/MISS move menus in
// scenePrompt.ts's MECHANICAL_OUTCOMES) was pure prompt instruction with
// zero server-side signal — no field captured which move the model
// actually picked, so it could reach for "inflict harm" on every miss
// forever and nothing in the codebase would detect, flag, or prevent it.
//
// Same "ask, don't infer" philosophy as outcome_echo/outcomeAdherence.ts:
// classifying prose to guess which move was narrated would need a second
// model call and be wrong often enough to be worse than nothing, so the
// model self-reports which move it used (move_used, a sibling field on
// each outcome_echo entry) and this module turns that self-report into
// (a) a measurable variety signal, mirroring checkOutcomeAdherence's own
// "a thing nobody measures cannot be said to be enforced" framing, and
// (b) a bounded per-scene "recently used" list fed back into the next
// prompt as a soft nudge against repeats — never a hard block.

/** The WEAK HIT move menu, exact phrasing from scenePrompt.ts's MECHANICAL_OUTCOMES. */
export const WEAK_HIT_MOVES = [
  'escalate danger',
  'extract a cost',
  'create urgency',
  'force a choice',
  'reveal an unwelcome truth',
  'split their attention',
] as const

/** The MISS move menu, exact phrasing from scenePrompt.ts's MECHANICAL_OUTCOMES. */
export const MISS_MOVES = [
  'inflict harm',
  'destroy or disable equipment',
  'drain a tracked resource',
  'capture or separate them from the group',
  'advance a threat clock',
  'trigger a flaw, condition, or vulnerability',
  'turn their own action back on them',
  'reveal a consequence of something they did earlier',
  'force an immediate hard choice under pressure',
  'create a moral complication',
] as const

export type MoveSlug = (typeof WEAK_HIT_MOVES)[number] | (typeof MISS_MOVES)[number]

const ALL_MOVES: readonly string[] = [...WEAK_HIT_MOVES, ...MISS_MOVES]

/**
 * Normalize a free-text move_used self-report against the canonical move
 * phrases. Deliberately lenient (trim/lowercase/collapse-whitespace/strip-
 * trailing-punctuation, then exact-or-containment match) and never throws
 * — an unrecognizable report just means "reported but unclassifiable,"
 * the same fail-open posture as the rest of this measurement layer.
 *
 * Not fuzzy-matched the way entity names are (resolveEntityByNameOrId):
 * these are a small, closed, hand-written vocabulary the prompt itself
 * defines verbatim, not a free-form roster the model could reasonably
 * paraphrase — a wrong/loose match here would corrupt the variety signal
 * itself, so containment is as far as this goes.
 */
export function normalizeMoveUsed(raw: string | undefined | null): MoveSlug | null {
  if (!raw) return null
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '')
  if (!cleaned) return null
  const exact = ALL_MOVES.find((m) => m === cleaned)
  if (exact) return exact as MoveSlug
  const contained = ALL_MOVES.find((m) => cleaned.includes(m))
  return (contained as MoveSlug | undefined) ?? null
}

// Bounded the same way sceneProgress.ts's MAX_ESTABLISHED_FACTS/
// MAX_RESOLVED_BEATS are — a per-scene nudge only needs recent history,
// not the whole scene's move log.
export const MAX_RECENT_MOVES = 5

/**
 * Pure bounded-history append. Repeats are deliberately kept, not deduped
 * — reaching for the same move twice in a row is exactly the signal this
 * whole mechanism exists to surface, so collapsing it away would defeat
 * the point.
 */
export function trackRecentMoves(existing: string[], newlyUsed: string[]): string[] {
  const combined = [...existing, ...newlyUsed.filter((m): m is string => !!m)]
  return combined.length > MAX_RECENT_MOVES ? combined.slice(-MAX_RECENT_MOVES) : combined
}

export interface MoveVarietyEntry {
  characterName: string
  band: 'weakHit' | 'miss'
  /** Raw self-report, unmodified, for display/debugging. */
  moveUsed: string | null
  /** Canonical slug once matched against the known vocabulary, or null if unclassifiable. */
  normalizedMove: MoveSlug | null
  /** Whether normalizedMove already appears in this scene's recent-moves history. */
  repeatsRecent: boolean
}

export interface MoveVarietyResult {
  entries: MoveVarietyEntry[]
  /** Entries whose move_used was reported and classifiable. */
  reported: number
  /** weakHit/miss entries with no move_used, or an unclassifiable one. */
  unreported: number
  /** Entries that repeat a move already used earlier in this same scene. */
  repeated: number
}

/**
 * Pure measurement — mirrors outcomeAdherence.ts's own framing exactly:
 * observes, never rewrites the scene, never blocks the turn. Only weakHit/
 * miss entries carry a move at all (a strongHit has nothing to pick from
 * the menus), so strongHit/unrecognized-band entries are skipped rather
 * than counted as "unreported."
 */
export function checkMoveVariety(
  outcomeEchoes: Array<{ character_name_or_id?: string; outcome?: string; move_used?: string }> | undefined,
  recentMoves: string[]
): MoveVarietyResult {
  const entries: MoveVarietyEntry[] = []
  let reported = 0
  let unreported = 0
  let repeated = 0

  for (const echo of outcomeEchoes ?? []) {
    if (echo.outcome !== 'weakHit' && echo.outcome !== 'miss') continue
    const normalizedMove = normalizeMoveUsed(echo.move_used)
    const repeatsRecent = normalizedMove !== null && recentMoves.includes(normalizedMove)
    if (normalizedMove) reported++
    else unreported++
    if (repeatsRecent) repeated++
    entries.push({
      characterName: echo.character_name_or_id ?? '',
      band: echo.outcome,
      moveUsed: echo.move_used ?? null,
      normalizedMove,
      repeatsRecent,
    })
  }

  return { entries, reported, unreported, repeated }
}
