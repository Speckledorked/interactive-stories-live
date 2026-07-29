import { describe, it, expect } from 'vitest'
import { ESCALATION_SOURCE_FILES, hasAttributedSource } from '../escalationSourceMap'
import { INTEGRITY_CHECKS, INTEGRITY_REPAIRS } from '../checkRegistry'

const REGISTERED_KEYS = new Set(INTEGRITY_CHECKS.map((c) => c.key))

describe('ESCALATION_SOURCE_FILES', () => {
  it('only references checkKeys that actually exist in the registry — catches typos/renames', () => {
    for (const key of Object.keys(ESCALATION_SOURCE_FILES)) {
      expect(REGISTERED_KEYS.has(key)).toBe(true)
    }
  })

  it('only attributes a source for checkKeys that have a real repair — attribution implies "this can recur after a real fix"', () => {
    for (const key of Object.keys(ESCALATION_SOURCE_FILES)) {
      expect(INTEGRITY_REPAIRS[key]).toBeDefined()
    }
  })

  it('every entry lists at least one file', () => {
    for (const files of Object.values(ESCALATION_SOURCE_FILES)) {
      expect(files.length).toBeGreaterThan(0)
    }
  })
})

describe('hasAttributedSource', () => {
  it('is true for an attributed checkKey', () => {
    expect(hasAttributedSource('character.relationships.keys.resolve')).toBe(true)
  })

  it('is false for a checkKey with no attribution (a safe, legitimate default)', () => {
    expect(hasAttributedSource('debt.counterpartyId.resolves')).toBe(false)
    expect(hasAttributedSource('some.made.up.key')).toBe(false)
  })
})
