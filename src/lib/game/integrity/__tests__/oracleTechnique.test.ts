import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import { ORACLE_TECHNIQUE_FOR, LINT_GUARD_FILE_FOR, oracleTechniqueFor, isWeakerTechnique } from '../oracleTechnique'
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

  it('defaults to suite-only for anything not declared — the weakest oracle, but it still auto-merges', () => {
    expect(oracleTechniqueFor('debt.counterpartyId.resolves')).toBe('suite-only')
    expect(oracleTechniqueFor('some.made.up.key')).toBe('suite-only')
  })
})

describe('isWeakerTechnique', () => {
  it('is true only for a move from a real oracle down to suite-only', () => {
    expect(isWeakerTechnique('property', 'suite-only')).toBe(true)
    expect(isWeakerTechnique('fault-injection', 'suite-only')).toBe(true)
    expect(isWeakerTechnique('lint', 'suite-only')).toBe(true)
  })

  it('is false moving between property/fault-injection/lint — none of those outrank each other', () => {
    expect(isWeakerTechnique('property', 'fault-injection')).toBe(false)
    expect(isWeakerTechnique('fault-injection', 'lint')).toBe(false)
    expect(isWeakerTechnique('lint', 'property')).toBe(false)
  })

  it('is false when staying the same, and false when strengthening from suite-only', () => {
    expect(isWeakerTechnique('suite-only', 'suite-only')).toBe(false)
    expect(isWeakerTechnique('suite-only', 'property')).toBe(false)
  })
})
