// scripts/__tests__/schemaDrift.test.ts
//
// The comparison is the whole check, so it is tested from the failing side —
// and the fixtures are VERBATIM output from the check's first real CI run,
// which found two genuine defects rather than the zero I expected.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { normalizeDiff, parseExpected, compareDrift, isEmptyDiff } from '../schemaDrift'

// Verbatim from the first run of this check (PR #455), before either finding
// was fixed. Both real defects are in here.
const FIRST_RUN = `
[*] Changed the \`CapabilityPrerequisite\` table
  [*] Renamed index \`CapabilityPrerequisite_capabilityId_prerequisiteCapabilityId_ke\` to \`CapabilityPrerequisite_capabilityId_prerequisiteCapabilityI_key\`

[*] Changed the \`campaign_memories\` table
  [-] Removed index on columns (involvedCharacterIds)
  [-] Removed index on columns (embedding)
  [-] Removed index on columns (involvedFactionIds)
  [-] Removed index on columns (involvedNpcIds)
  [-] Removed column \`createdAt\`
`

// What remains once those two are fixed: the four raw-SQL indexes only.
const RESIDUAL = `
[*] Changed the \`campaign_memories\` table
  [-] Removed index on columns (involvedCharacterIds)
  [-] Removed index on columns (embedding)
  [-] Removed index on columns (involvedFactionIds)
  [-] Removed index on columns (involvedNpcIds)
`

describe('normalizing prisma migrate diff output', () => {
  it('drops the CLI version-nag box, which is not schema information', () => {
    const withBanner = `┌─────────────────────────────────────────────┐
│  Update available 5.22.0 -> 7.9.1           │
└─────────────────────────────────────────────┘
[*] Changed the \`campaign_memories\` table`

    expect(normalizeDiff(withBanner)).toEqual(['[*] Changed the `campaign_memories` table'])
  })

  it('sorts, so a reordered index block is not a failure', () => {
    // Prisma does not promise a stable order inside a table block, and a check
    // that fails because two lines swapped places gets rerun until green.
    const a = normalizeDiff('[-] Removed index on columns (b)\n[-] Removed index on columns (a)')
    const b = normalizeDiff('[-] Removed index on columns (a)\n[-] Removed index on columns (b)')
    expect(a).toEqual(b)
  })

  it('recognises an empty diff', () => {
    expect(isEmptyDiff(normalizeDiff('No difference detected.'))).toBe(true)
    expect(isEmptyDiff(normalizeDiff(''))).toBe(true)
    expect(isEmptyDiff(normalizeDiff(RESIDUAL))).toBe(false)
  })
})

describe('comparing against the recorded residual', () => {
  const expected = parseExpected(readFileSync(join(process.cwd(), 'prisma', 'schema-drift-expected.txt'), 'utf-8'))

  it('the real snapshot file parses to the four raw-SQL index lines plus its table header', () => {
    // If the snapshot ever parsed to nothing, every comparison below would
    // pass vacuously and the check would be asserting nothing at all.
    expect(expected.length).toBe(5)
    expect(expected.filter((l) => l.includes('Removed index'))).toHaveLength(4)
  })

  it('passes when the live diff is exactly the recorded residual', () => {
    expect(compareDrift(normalizeDiff(RESIDUAL), expected).ok).toBe(true)
  })

  it('FAILS on the first run output — the two real findings are unexpected', () => {
    const { unexpected, stale, ok } = compareDrift(normalizeDiff(FIRST_RUN), expected)

    expect(ok).toBe(false)
    expect(stale).toEqual([])
    // The column absent from the model, and the truncated index name.
    expect(unexpected.some((l) => l.includes('Removed column `createdAt`'))).toBe(true)
    expect(unexpected.some((l) => l.includes('Renamed index'))).toBe(true)
    expect(unexpected.some((l) => l.includes('CapabilityPrerequisite'))).toBe(true)
  })

  it('FAILS on a newly dropped column, the case this check exists for', () => {
    const withDrift = normalizeDiff(RESIDUAL + '\n  [-] Removed column `somethingNew`')
    const { unexpected, ok } = compareDrift(withDrift, expected)
    expect(ok).toBe(false)
    expect(unexpected).toEqual(['[-] Removed column `somethingNew`'])
  })

  it('FAILS on a stale expectation, so the exception list cannot rot', () => {
    // Someone expresses the GIN indexes in the datamodel: those lines vanish
    // from the diff, and the snapshot must be pruned to match.
    const fewer = normalizeDiff(
      '[*] Changed the `campaign_memories` table\n  [-] Removed index on columns (embedding)'
    )
    const { unexpected, stale, ok } = compareDrift(fewer, expected)

    expect(ok).toBe(false)
    expect(unexpected).toEqual([])
    expect(stale).toHaveLength(3)
  })

  it('FAILS when the diff goes completely empty while the snapshot expects lines', () => {
    const { stale, ok } = compareDrift(normalizeDiff('No difference detected.'), expected)
    expect(ok).toBe(false)
    expect(stale).toHaveLength(5)
  })
})

describe('the snapshot file itself', () => {
  const raw = readFileSync(join(process.cwd(), 'prisma', 'schema-drift-expected.txt'), 'utf-8')

  it('explains why each exception cannot be expressed', () => {
    // An exception without a reason is indistinguishable from drift someone
    // silenced, which is the failure mode this whole check is about.
    expect(raw).toMatch(/hnsw/i)
    expect(raw).toMatch(/cannot|no syntax|never be represented/i)
  })

  it('comment lines are documentation, not diff content', () => {
    expect(parseExpected('# [-] Removed column `x`\n[-] Removed column `y`')).toEqual([
      '[-] Removed column `y`',
    ])
  })
})
