import { describe, it, expect } from 'vitest'
import { verifyOracleTechnique } from '../verifyOracleTechnique'

describe('verifyOracleTechnique — property', () => {
  it('is satisfied when a changed test file imports fast-check', () => {
    const result = verifyOracleTechnique('character.relationships.keys.resolve', 'property', 'property', {
      'foo.test.ts': "import fc from 'fast-check'\nfc.assert(fc.property(fc.string(), () => true))",
    })
    expect(result.satisfied).toBe(true)
  })

  it('is NOT satisfied by a plain example-based test claiming to be a property test', () => {
    const result = verifyOracleTechnique('character.relationships.keys.resolve', 'property', 'property', {
      'foo.test.ts': "it('works', () => { expect(1).toBe(1) })",
    })
    expect(result.satisfied).toBe(false)
    expect(result.reason).toMatch(/fast-check/)
  })

  it('checks across every changed file, not just the first', () => {
    const result = verifyOracleTechnique('character.relationships.keys.resolve', 'property', 'property', {
      'a.test.ts': 'describe(() => {})',
      'b.test.ts': "import fc from 'fast-check'",
    })
    expect(result.satisfied).toBe(true)
  })
})

describe('verifyOracleTechnique — fault-injection', () => {
  it('is satisfied when a changed test file gates on RUN_DB_TESTS', () => {
    const result = verifyOracleTechnique('war.contestedLocationId.resolves', 'fault-injection', 'fault-injection', {
      'foo.test.ts': "const RUN = process.env.RUN_DB_TESTS === '1'",
    })
    expect(result.satisfied).toBe(true)
  })

  it('is NOT satisfied by a mocked-Prisma test claiming to be fault injection', () => {
    const result = verifyOracleTechnique('war.contestedLocationId.resolves', 'fault-injection', 'fault-injection', {
      'foo.test.ts': "vi.mock('@/lib/prisma', () => ({ prisma: {} }))",
    })
    expect(result.satisfied).toBe(false)
    expect(result.reason).toMatch(/RUN_DB_TESTS/)
  })
})

describe('verifyOracleTechnique — lint', () => {
  it('is satisfied when the checkKey has a registered guard file that actually exists', () => {
    const result = verifyOracleTechnique(
      'character.relationships.keys.resolve',
      'lint',
      'lint',
      {},
      new Set(['src/lib/game/worldUpdaters/__tests__/entityResolutionConvention.test.ts'])
    )
    expect(result.satisfied).toBe(true)
    expect(result.reason).toMatch(/entityResolutionConvention/)
  })

  it('is NOT satisfied when the checkKey has no registered guard file at all', () => {
    const result = verifyOracleTechnique('debt.counterpartyId.resolves', 'lint', 'lint', {})
    expect(result.satisfied).toBe(false)
    expect(result.reason).toMatch(/no AST-based structural guard is registered/)
  })

  it('is NOT satisfied when the registered guard file has gone missing on disk — a stale registry', () => {
    const result = verifyOracleTechnique('character.relationships.keys.resolve', 'lint', 'lint', {}, new Set())
    expect(result.satisfied).toBe(false)
    expect(result.reason).toMatch(/no longer exists/)
  })
})

describe('verifyOracleTechnique — suite-only', () => {
  it('is satisfied on its own — the full suite passing (checked separately) is the whole proof', () => {
    const result = verifyOracleTechnique('debt.counterpartyId.resolves', 'suite-only', 'suite-only', {})
    expect(result.satisfied).toBe(true)
  })
})

describe('verifyOracleTechnique — self-weakening (there is no human backstop, so this is load-bearing)', () => {
  it('fails unconditionally when a diff downgrades its checkKey from a real oracle to suite-only', () => {
    const result = verifyOracleTechnique(
      'character.relationships.keys.resolve',
      'property',
      'suite-only',
      { 'foo.test.ts': "it('works', () => { expect(1).toBe(1) })" }
    )
    expect(result.satisfied).toBe(false)
    expect(result.weakened).toBe(true)
    expect(result.reason).toMatch(/weaker/)
  })

  it('does not even bother checking file content once a weakening is detected', () => {
    // Even a file that WOULD satisfy suite-only (trivially, anything does)
    // must not save a diff that weakened its own bar.
    const result = verifyOracleTechnique('war.contestedLocationId.resolves', 'fault-injection', 'suite-only', {})
    expect(result.satisfied).toBe(false)
    expect(result.weakened).toBe(true)
  })

  it('allows moving between two real oracles (neither outranks the other)', () => {
    const result = verifyOracleTechnique(
      'character.relationships.keys.resolve',
      'property',
      'fault-injection',
      { 'foo.test.ts': "const RUN = process.env.RUN_DB_TESTS === '1'" }
    )
    expect(result.weakened).toBe(false)
    expect(result.satisfied).toBe(true)
  })

  it('allows strengthening from suite-only up to a real oracle', () => {
    const result = verifyOracleTechnique(
      'debt.counterpartyId.resolves',
      'suite-only',
      'property',
      { 'foo.test.ts': "import fc from 'fast-check'" }
    )
    expect(result.weakened).toBe(false)
    expect(result.satisfied).toBe(true)
  })
})
