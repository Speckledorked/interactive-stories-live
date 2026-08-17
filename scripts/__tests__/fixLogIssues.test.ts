// scripts/__tests__/fixLogIssues.test.ts
//
// #453. Two things have to be right here, and the second is the harder one.
//
// 1. The parser has to find the Fix Log's trailing issue references.
// 2. It has to find ONLY those. ARCHITECTURE.md mentions ~138 distinct issue
//    numbers and most are mid-sentence context — "the gap #279 named",
//    "superseded by #375". A mid-sentence mention is not a claim that the
//    issue is closed, and treating it as one would report a violation for
//    every issue the docs merely discuss.
//
// The last test runs the parser against the REAL ARCHITECTURE.md, because a
// parser tested only on hand-written fixtures is a parser tested against my
// assumptions about the file rather than the file.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseFixLogIssues, findDivergence } from '../fixLogIssues'

const FIXTURE = [
  '# Doc',
  '',
  '## Scorecard',
  '',
  '| System | Score | Status |',
  '| --- | --- | --- |',
  '| Something | 4 | The gap #279 named is fixed. |',
  '',
  '## Fix Log',
  '',
  '- A thing was broken and is now fixed. *(Some row)* #288',
  '- A second thing, which superseded #200, is fixed. *(Another row)* #290',
  '- An entry with no row tag at all. #291',
  '- An entry that only discusses #123 and ends in prose.',
  '',
  '## Priority List',
  '',
  '- Still open: #999',
].join('\n')

describe('parsing the Fix Log (#453)', () => {
  const entries = parseFixLogIssues(FIXTURE)

  it('finds the trailing issue reference on each entry', () => {
    expect(entries.map((e) => e.issue)).toEqual([288, 290, 291])
  })

  it('captures the Scorecard row when the entry names one', () => {
    expect(entries[0].row).toBe('Some row')
    expect(entries[2].row).toBeNull()
  })

  it('ignores a mid-sentence mention inside an entry', () => {
    // #200 is discussed by the second entry, not claimed as fixed by it.
    expect(entries.map((e) => e.issue)).not.toContain(200)
  })

  it('ignores an entry that ends in prose rather than a reference', () => {
    expect(entries.map((e) => e.issue)).not.toContain(123)
  })

  it('does not read outside the Fix Log section', () => {
    // #279 is in the Scorecard, #999 in the Priority List. Neither is a
    // claim that the issue is closed — the Priority List means the opposite.
    expect(entries.map((e) => e.issue)).not.toContain(279)
    expect(entries.map((e) => e.issue)).not.toContain(999)
  })

  it('returns nothing when there is no Fix Log', () => {
    expect(parseFixLogIssues('# Doc\n\n## Scorecard\n\n- #1')).toEqual([])
  })
})

describe('comparing against open issues (#453)', () => {
  const entries = parseFixLogIssues(FIXTURE)

  it('reports an entry whose issue is still open', () => {
    const diverged = findDivergence(entries, new Set([290]))
    expect(diverged.map((d) => d.issue)).toEqual([290])
    expect(diverged[0].row).toBe('Another row')
  })

  it('is silent when every referenced issue is closed', () => {
    expect(findDivergence(entries, new Set())).toEqual([])
  })

  it('reports the exact state PR #452 left behind', () => {
    // Ten issues described as fixed, nine still open because a
    // comma-separated closing list closed only the first.
    const tenEntries = Array.from({ length: 10 }, (_, i) => ({
      issue: 436 + i, row: null, excerpt: 'fixed',
    }))
    const stillOpen = new Set([437, 438, 439, 440, 441, 442, 443, 444, 445])

    expect(findDivergence(tenEntries, stillOpen).map((d) => d.issue)).toEqual([...stillOpen])
  })

  it('reports each issue once even when several entries cite it', () => {
    // A defect fixed across two commits gets two Fix Log bullets; the report
    // should name the issue once, not once per bullet.
    const duplicated = [
      { issue: 500, row: 'A', excerpt: 'first half' },
      { issue: 500, row: 'B', excerpt: 'second half' },
    ]
    expect(findDivergence(duplicated, new Set([500]))).toHaveLength(1)
  })

  it('treats an issue missing from the open set as closed', () => {
    // Fails SAFE. If the API list is short or a page is missed, this
    // under-reports rather than accusing a closed issue of being open — a
    // false alarm on a daily check is how a daily check gets muted.
    expect(findDivergence(entries, new Set([12345]))).toEqual([])
  })
})

describe('against the real ARCHITECTURE.md', () => {
  const doc = readFileSync(join(process.cwd(), 'docs', 'ARCHITECTURE.md'), 'utf-8')
  const entries = parseFixLogIssues(doc)

  it('finds the entries it is meant to be checking', () => {
    // A parser that silently matches nothing passes forever. The Fix Log had
    // 57 trailing references when this was written.
    expect(entries.length).toBeGreaterThanOrEqual(50)
  })

  it('finds far fewer references than the document mentions', () => {
    // The discrimination this parser exists for, measured against the real
    // file: ~138 distinct issue numbers appear in ARCHITECTURE.md, and only
    // the trailing attributions are claims of closure. If this ratio ever
    // approaches 1 the parser has started matching prose.
    const allMentions = new Set((doc.match(/#\d{2,4}/g) ?? []).map((m) => m.slice(1)))
    expect(entries.length).toBeLessThan(allMentions.size)
  })

  it('reads plausible issue numbers, not line numbers or scores', () => {
    for (const entry of entries) {
      expect(entry.issue).toBeGreaterThan(9)
      expect(entry.issue).toBeLessThan(10000)
    }
  })
})
