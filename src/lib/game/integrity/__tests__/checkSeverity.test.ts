import { describe, it, expect } from 'vitest'
import { CHECK_SEVERITY, DEFAULT_SEVERITY, severityOf } from '../checkSeverity'
import { INTEGRITY_CHECKS, INTEGRITY_REPAIRS } from '../checkRegistry'

const REGISTERED_KEYS = new Set(INTEGRITY_CHECKS.map((c) => c.key))

describe('CHECK_SEVERITY', () => {
  it('only references checkKeys that actually exist in the registry — catches typos/renames', () => {
    for (const key of Object.keys(CHECK_SEVERITY)) {
      expect(REGISTERED_KEYS.has(key)).toBe(true)
    }
  })

  it('only ranks checkKeys that actually have a real repair — an unranked, detect-only checkKey never competes for the budget anyway', () => {
    for (const key of Object.keys(CHECK_SEVERITY)) {
      expect(INTEGRITY_REPAIRS[key]).toBeDefined()
    }
  })

  it('ranks the leaderless-faction check as the single most severe', () => {
    const worst = Math.min(...Object.values(CHECK_SEVERITY) as number[])
    expect(CHECK_SEVERITY['faction.leadership.exactlyOneLivingLeader']).toBe(worst)
  })
})

describe('severityOf', () => {
  it('returns the ranked severity for a ranked checkKey', () => {
    expect(severityOf('faction.leadership.exactlyOneLivingLeader')).toBe(0)
  })

  it('defaults to DEFAULT_SEVERITY for an unranked or unknown checkKey', () => {
    expect(severityOf('some.made.up.key')).toBe(DEFAULT_SEVERITY)
    // Detect-only checkKeys are deliberately left unranked.
    expect(severityOf('clock.sourceFactionId.active')).toBe(DEFAULT_SEVERITY)
  })

  it('orders the leaderless-faction check before the referential-integrity family', () => {
    expect(severityOf('faction.leadership.exactlyOneLivingLeader'))
      .toBeLessThan(severityOf('character.relationships.keys.resolve'))
  })
})
