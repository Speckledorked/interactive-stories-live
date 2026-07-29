import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import { ORACLE_TECHNIQUE_FOR, LINT_GUARD_FILE_FOR, oracleTechniqueFor, isAutoMergeEligibleTechnique } from '../oracleTechnique'
import { INTEGRITY_CHECKS } from '../checkRegistry'

const REGISTERED_KEYS = new Set(INTEGRITY_CHECKS.map((c) => c.key))
const REPO_ROOT = join(__dirname, '../../../../..')

describe('ORACLE_TECHNIQUE_FOR', () => {
  it('only references checkKeys that actually exist in the registry', () => {
    for (const key of Object.keys(ORACLE_TECHNIQUE_FOR)) {
      expect(REGISTERED_KEYS.has(key)).toBe(true)
    }
  })
})

describe('LINT_GUARD_FILE_FOR', () => {
  it('only references checkKeys that actually exist in the registry', () => {
    for (const key of Object.keys(LINT_GUARD_FILE_FOR)) {
      expect(REGISTERED_KEYS.has(key)).toBe(true)
    }
  })

  it('every registered guard file genuinely exists on disk — catches a stale/renamed reference', () => {
    for (const path of Object.values(LINT_GUARD_FILE_FOR)) {
      expect(existsSync(join(REPO_ROOT, path))).toBe(true)
    }
  })
})

describe('oracleTechniqueFor', () => {
  it('returns the declared technique for a known checkKey', () => {
    expect(oracleTechniqueFor('character.relationships.keys.resolve')).toBe('property')
    expect(oracleTechniqueFor('war.contestedLocationId.resolves')).toBe('fault-injection')
  })

  it('defaults to suite-only for anything not declared — the weakest, never-auto-merge-eligible oracle', () => {
    expect(oracleTechniqueFor('debt.counterpartyId.resolves')).toBe('suite-only')
    expect(oracleTechniqueFor('some.made.up.key')).toBe('suite-only')
  })
})

describe('isAutoMergeEligibleTechnique', () => {
  it('is true for property, fault-injection, and lint', () => {
    expect(isAutoMergeEligibleTechnique('property')).toBe(true)
    expect(isAutoMergeEligibleTechnique('fault-injection')).toBe(true)
    expect(isAutoMergeEligibleTechnique('lint')).toBe(true)
  })

  it('is false for suite-only — the case proven insufficient twice in this codebase', () => {
    expect(isAutoMergeEligibleTechnique('suite-only')).toBe(false)
  })
})
