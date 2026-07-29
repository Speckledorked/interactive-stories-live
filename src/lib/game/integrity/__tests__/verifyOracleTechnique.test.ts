import { describe, it, expect } from 'vitest'
import { verifyOracleTechnique } from '../verifyOracleTechnique'

describe('verifyOracleTechnique — property', () => {
  it('is satisfied when a changed test file imports fast-check', () => {
    const result = verifyOracleTechnique('property', {
      'foo.test.ts': "import fc from 'fast-check'\nfc.assert(fc.property(fc.string(), () => true))",
    })
    expect(result.satisfied).toBe(true)
  })

  it('is NOT satisfied by a plain example-based test claiming to be a property test', () => {
    const result = verifyOracleTechnique('property', {
      'foo.test.ts': "it('works', () => { expect(1).toBe(1) })",
    })
    expect(result.satisfied).toBe(false)
    expect(result.reason).toMatch(/fast-check/)
  })

  it('checks across every changed file, not just the first', () => {
    const result = verifyOracleTechnique('property', {
      'a.test.ts': 'describe(() => {})',
      'b.test.ts': "import fc from 'fast-check'",
    })
    expect(result.satisfied).toBe(true)
  })
})

describe('verifyOracleTechnique — fault-injection', () => {
  it('is satisfied when a changed test file gates on RUN_DB_TESTS', () => {
    const result = verifyOracleTechnique('fault-injection', {
      'foo.test.ts': "const RUN = process.env.RUN_DB_TESTS === '1'",
    })
    expect(result.satisfied).toBe(true)
  })

  it('is NOT satisfied by a mocked-Prisma test claiming to be fault injection', () => {
    const result = verifyOracleTechnique('fault-injection', {
      'foo.test.ts': "vi.mock('@/lib/prisma', () => ({ prisma: {} }))",
    })
    expect(result.satisfied).toBe(false)
    expect(result.reason).toMatch(/RUN_DB_TESTS/)
  })
})

describe('verifyOracleTechnique — lint', () => {
  it('is never satisfied — no ESLint rule exists in this repo yet', () => {
    const result = verifyOracleTechnique('lint', { 'foo.test.ts': 'anything' })
    expect(result.satisfied).toBe(false)
  })
})

describe('verifyOracleTechnique — suite-only', () => {
  it('is always satisfied — nothing extra to check, and never auto-merge-eligible regardless', () => {
    const result = verifyOracleTechnique('suite-only', {})
    expect(result.satisfied).toBe(true)
  })
})
