import { describe, it, expect } from 'vitest'
import { parseWorldRules, ruleFor, isRuleActive, MIN_RULE_CONFIDENCE, RULE_PROBATION_TURNS, WorldRule } from '../worldRules'

const rule = (over: Partial<WorldRule> = {}): WorldRule => ({
  familyKey: 'faction.leaderOptional',
  applies: true,
  confidence: 0.9,
  rationale: 'An anarchist collective has no single leader by design.',
  sinceTurn: 0,
  ...over,
})

describe('parseWorldRules', () => {
  it('returns null for absent or non-object input', () => {
    expect(parseWorldRules(null)).toBeNull()
    expect(parseWorldRules(undefined)).toBeNull()
    expect(parseWorldRules('nope')).toBeNull()
    expect(parseWorldRules(42)).toBeNull()
  })

  it('returns null when rules is not an array', () => {
    expect(parseWorldRules({ rules: 'nope' })).toBeNull()
    expect(parseWorldRules({})).toBeNull()
  })

  it('parses a well-formed rule', () => {
    const parsed = parseWorldRules({
      rules: [
        {
          familyKey: 'faction.leaderOptional',
          applies: true,
          confidence: 0.85,
          rationale: 'Hive-mind factions act collectively.',
          sourceLoreIds: ['lore1'],
          sinceTurn: 4,
        },
      ],
    })
    expect(parsed?.rules).toHaveLength(1)
    expect(parsed?.rules[0]).toMatchObject({
      familyKey: 'faction.leaderOptional',
      applies: true,
      confidence: 0.85,
      rationale: 'Hive-mind factions act collectively.',
      sourceLoreIds: ['lore1'],
      sinceTurn: 4,
    })
  })

  it('drops an entry with an unknown familyKey — the catalogue is closed', () => {
    const parsed = parseWorldRules({
      rules: [{ familyKey: 'faction.canTimeTravel', applies: true, confidence: 0.9, sinceTurn: 0 }],
    })
    expect(parsed?.rules).toHaveLength(0)
  })

  it('drops an entry missing a boolean applies', () => {
    const parsed = parseWorldRules({
      rules: [{ familyKey: 'faction.leaderOptional', confidence: 0.9, sinceTurn: 0 }],
    })
    expect(parsed?.rules).toHaveLength(0)
  })

  it('clamps a confidence outside 0-1 and defaults a missing/invalid one to 0', () => {
    const parsed = parseWorldRules({
      rules: [
        { familyKey: 'faction.leaderOptional', applies: true, confidence: 5, sinceTurn: 0 },
      ],
    })
    expect(parsed?.rules[0].confidence).toBe(1)

    const parsed2 = parseWorldRules({
      rules: [{ familyKey: 'faction.leaderOptional', applies: true, confidence: 'high', sinceTurn: 0 }],
    })
    expect(parsed2?.rules[0].confidence).toBe(0)
  })
})

describe('ruleFor', () => {
  it('returns null when worldRules is null', () => {
    expect(ruleFor(null, 'faction.leaderOptional')).toBeNull()
  })

  it('finds the matching rule by familyKey', () => {
    const r = rule()
    expect(ruleFor({ rules: [r] }, 'faction.leaderOptional')).toBe(r)
  })

  it('returns null when no rule matches', () => {
    expect(ruleFor({ rules: [] }, 'faction.leaderOptional')).toBeNull()
  })
})

describe('isRuleActive', () => {
  it('is false for a null rule', () => {
    expect(isRuleActive(null, 100)).toBe(false)
  })

  it('is false when applies is false, regardless of confidence/age', () => {
    expect(isRuleActive(rule({ applies: false, sinceTurn: 0 }), 100)).toBe(false)
  })

  it(`is false below MIN_RULE_CONFIDENCE (${MIN_RULE_CONFIDENCE})`, () => {
    expect(isRuleActive(rule({ confidence: MIN_RULE_CONFIDENCE - 0.01, sinceTurn: 0 }), 100)).toBe(false)
  })

  it('is true at exactly MIN_RULE_CONFIDENCE once past probation', () => {
    expect(isRuleActive(rule({ confidence: MIN_RULE_CONFIDENCE, sinceTurn: 0 }), 100)).toBe(true)
  })

  it(`is false during the ${RULE_PROBATION_TURNS}-turn probation window after sinceTurn`, () => {
    expect(isRuleActive(rule({ sinceTurn: 10 }), 10)).toBe(false)
    expect(isRuleActive(rule({ sinceTurn: 10 }), 10 + RULE_PROBATION_TURNS - 1)).toBe(false)
  })

  it('is true once the probation window has fully elapsed', () => {
    expect(isRuleActive(rule({ sinceTurn: 10 }), 10 + RULE_PROBATION_TURNS)).toBe(true)
  })
})
