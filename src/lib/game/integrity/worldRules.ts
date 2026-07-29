// src/lib/game/integrity/worldRules.ts
// Integrity Engine Phase 4 — universe-scoped semantic invariants.
//
// The key safety move (see the plan's Phase 4b): the AI never writes a
// predicate. It only picks, from a closed and hard-coded catalogue of
// check families, WHICH ones apply to this campaign's fiction and with
// what confidence — every family's detection and repair logic already
// exists in code, reviewed, before any rule can ever reference it. A
// `familyKey` that doesn't match a registered family is dropped at parse
// time; it can never activate anything.
//
// Same parse-boundary shape as corruption.ts's parseCorruptionTheme:
// validate on read, return null on anything malformed, never trust the
// column's shape. Absence (null) is always the safe state — every
// semantic check simply degrades to its unconditional Phase 1/1b
// behavior, never to something MORE aggressive.

/**
 * The closed catalogue. Adding a family is a code change with tests (see
 * the plan's Phase 4e) — this list is deliberately not "whatever key the
 * AI feels like inventing."
 *
 * 'faction.leaderOptional': in most fiction, a faction with living members
 * and no leader is a bug (the plan's own headline example: "a kingdom has
 * exactly one monarch" — enforced today by
 * checks/factionLeadership.ts:factionHasOneLivingLeader). Some settings
 * make that false on purpose — an anarchist collective, a hive mind, a
 * long interregnum played as a real story beat — and this family lets
 * canon say so.
 */
export type SemanticCheckFamilyKey = 'faction.leaderOptional'

const KNOWN_FAMILY_KEYS: ReadonlySet<SemanticCheckFamilyKey> = new Set(['faction.leaderOptional'])

export interface WorldRule {
  familyKey: SemanticCheckFamilyKey
  /** Whether this family's alternate behavior applies to this campaign. */
  applies: boolean
  params?: Record<string, unknown>
  /** 0-1. Below MIN_RULE_CONFIDENCE the rule is recorded but never takes effect. */
  confidence: number
  rationale: string
  sourceLoreIds?: string[]
  /** Turn this rule was (re)generated on — gates the probation window below. */
  sinceTurn: number
}

export interface WorldRules {
  rules: WorldRule[]
}

/** Below this confidence, a rule is reported but never changes behavior — a
 * low-confidence guess is exactly the kind of wrong verdict 4d's
 * containment exists to neutralize before it ever reaches a repair. */
export const MIN_RULE_CONFIDENCE = 0.6

/** A freshly (re)generated rule sits out this many turns before it can
 * change behavior — "detect-before-repair" (4d) for a rule new enough that
 * a wrong verdict hasn't had a chance to be noticed and corrected yet. */
export const RULE_PROBATION_TURNS = 3

/** Parse the Json column into a usable set of rules, or null if
 * absent/malformed. Never throws. */
export function parseWorldRules(raw: unknown): WorldRules | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.rules)) return null

  const rules: WorldRule[] = []
  for (const entry of r.rules) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (!KNOWN_FAMILY_KEYS.has(e.familyKey as SemanticCheckFamilyKey)) continue
    if (typeof e.applies !== 'boolean') continue

    const confidence = Number(e.confidence)
    const sinceTurn = Number(e.sinceTurn)
    rules.push({
      familyKey: e.familyKey as SemanticCheckFamilyKey,
      applies: e.applies,
      params: e.params && typeof e.params === 'object' ? (e.params as Record<string, unknown>) : undefined,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      rationale: typeof e.rationale === 'string' ? e.rationale : '',
      sourceLoreIds: Array.isArray(e.sourceLoreIds) ? e.sourceLoreIds.map(String) : undefined,
      sinceTurn: Number.isFinite(sinceTurn) ? Math.floor(sinceTurn) : 0,
    })
  }
  return { rules }
}

/** The rule for a given family, if this campaign has one on record. */
export function ruleFor(worldRules: WorldRules | null, familyKey: SemanticCheckFamilyKey): WorldRule | null {
  if (!worldRules) return null
  return worldRules.rules.find((r) => r.familyKey === familyKey) ?? null
}

/**
 * Whether a rule actually changes behavior right now. False for a missing,
 * disabled, low-confidence, or still-on-probation rule — every one of
 * those cases means "run the check exactly as if this family didn't
 * exist," which is what keeps a wrong verdict's worst case being "the
 * unconditional Phase 1/1b default," never something more aggressive.
 */
export function isRuleActive(rule: WorldRule | null, currentTurn: number): boolean {
  if (!rule) return false
  if (!rule.applies) return false
  if (rule.confidence < MIN_RULE_CONFIDENCE) return false
  if (currentTurn - rule.sinceTurn < RULE_PROBATION_TURNS) return false
  return true
}
