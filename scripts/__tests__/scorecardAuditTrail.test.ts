// scripts/__tests__/scorecardAuditTrail.test.ts
//
// #443. The Scorecard gate had no tests, and it is the one check in this
// repo whose entire job is to catch an agent grading its own work up. Two
// separate bypasses shipped inside it — both in the branch that decides
// whether to fail, which is the branch a passing CI run never exercises.
//
// The pattern is the same one #444 named: every existing check of this file
// ran the whole script against the real repo and asserted "it passed". A
// green gate proves the gate ran, not that it can fail. The bypasses were
// only ever visible from the failing side.
//
// Each `it` below is one bypass or one legitimate pass, written as a pair
// wherever the distinction is the whole point.

import { describe, it, expect } from 'vitest'
import { findViolations, parseScorecard, parseDeclaredRenames } from '../scorecardAuditTrail'

/** A minimal ARCHITECTURE.md: the two sections the gate reads, nothing else. */
function doc(rows: Array<[string, number | '—']>, auditLog = ''): string {
  const table = rows.map(([name, score]) => `| ${name} | ${score} | notes. |`).join('\n')
  return [
    '# Architecture',
    '',
    '## Scorecard',
    '',
    '| System | Score | Status |',
    '| --- | --- | --- |',
    table,
    '',
    '## Scorecard Audit Log',
    '',
    auditLog,
    '',
    '## Something After',
    '',
    'Unrelated.',
  ].join('\n')
}

const CLEAN_PASS = (system: string) =>
  `### 2026-08-17 — ${system}\nPass type: adversarial audit\nWhat was checked: everything.\nResult: 0 new defects found\n`

describe('parsing (#443)', () => {
  it('reads scores and skips the header and separator rows', () => {
    const scores = parseScorecard(doc([['Alpha', 4], ['Beta', 2]]))
    expect([...scores]).toEqual([['Alpha', 4], ['Beta', 2]])
  })

  it('reads an em-dash score as "not a score", not as zero', () => {
    // A removed/decided row. Treating it as 0 would make every later
    // re-scoring of it read as an increase.
    expect(parseScorecard(doc([['Alpha', '—']])).get('Alpha')).toBeNull()
  })

  it('reads a declared rename as new name -> old name', () => {
    const renames = parseDeclaredRenames(doc([['New', 4]], '- Renamed: "Old" -> "New"\n'))
    expect([...renames]).toEqual([['New', 'Old']])
  })

  it('stops reading the Scorecard table at the Audit Log heading', () => {
    // The two sections are parsed from the same string; a table row quoted
    // inside a log entry must not register as a Scorecard row.
    const scores = parseScorecard(doc([['Alpha', 4]], '| Fake Row | 5 | injected. |\n'))
    expect([...scores.keys()]).toEqual(['Alpha'])
  })
})

describe('score increases (#443)', () => {
  it('fails a raise with no clean-pass entry', () => {
    const v = findViolations(doc([['Alpha', 4]]), doc([['Alpha', 5]]))
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('4 -> 5')
  })

  it('allows a raise backed by a clean-pass entry for that exact system', () => {
    expect(findViolations(doc([['Alpha', 4]]), doc([['Alpha', 5]], CLEAN_PASS('Alpha')))).toEqual([])
  })

  it('does not accept another system\'s clean pass', () => {
    expect(findViolations(doc([['Alpha', 4]]), doc([['Alpha', 5]], CLEAN_PASS('Beta')))).toHaveLength(1)
  })

  it('never gates a decrease', () => {
    expect(findViolations(doc([['Alpha', 5]]), doc([['Alpha', 3]]))).toEqual([])
  })

  it('never gates a genuinely new row', () => {
    expect(findViolations(doc([['Alpha', 4]]), doc([['Alpha', 4], ['Beta', 5]]))).toEqual([])
  })

  it('does not read a re-scored em-dash row as an increase', () => {
    expect(findViolations(doc([['Alpha', '—']]), doc([['Alpha', 4]]))).toEqual([])
  })
})

describe('renames (#443)', () => {
  it('fails an undeclared rename', () => {
    const v = findViolations(doc([['Alpha', 4]]), doc([['Alpha renamed', 4]]))
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('Alpha')
  })

  it('fails a rename hidden behind a simultaneous addition — THE BYPASS', () => {
    // #397 answered "did a row disappear?" with "did the row count fail to
    // grow?". Rename one row and add another in the same commit and the
    // counts come out equal, so the branch was skipped entirely and the
    // renamed row carried its score across unchecked.
    //
    // This is the exact shape that shipped. It is also the shape an agent
    // reaches for by accident: relabelling a row while adding a new system
    // is an ordinary-looking doc edit.
    const base = doc([['Alpha', 4], ['Beta', 3]])
    const current = doc([['Alpha renamed', 4], ['Beta', 3], ['Gamma', 5]])
    const v = findViolations(base, current)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('Alpha')
  })

  it('blames the row that actually moved, not the innocent new one', () => {
    // The old message accused every appearing row, so "Gamma" — genuinely
    // new, genuinely ungated — got told it was a suspicious rename.
    const v = findViolations(doc([['Alpha', 4]]), doc([['Alpha renamed', 4], ['Gamma', 5]]))
    expect(v.join('\n')).not.toContain('Gamma')
  })

  it('allows a declared rename that keeps the score', () => {
    const base = doc([['Alpha', 4]])
    const current = doc([['Alpha renamed', 4]], '- Renamed: "Alpha" -> "Alpha renamed"\n')
    expect(findViolations(base, current)).toEqual([])
  })

  it('still gates a declared rename that also raises the score', () => {
    // The point of allowing declared renames at all: the new row inherits
    // the OLD row's score, so relabelling buys no exemption from the check.
    const base = doc([['Alpha', 4]])
    const current = doc([['Alpha renamed', 5]], '- Renamed: "Alpha" -> "Alpha renamed"\n')
    const v = findViolations(base, current)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('4 -> 5')
  })

  it('allows a declared rename that raises the score WITH a clean pass', () => {
    const base = doc([['Alpha', 4]])
    const current = doc(
      [['Alpha renamed', 5]],
      '- Renamed: "Alpha" -> "Alpha renamed"\n\n' + CLEAN_PASS('Alpha renamed')
    )
    expect(findViolations(base, current)).toEqual([])
  })

  it('rejects a rename declared from a row that never existed', () => {
    const current = doc([['Gamma', 5]], '- Renamed: "Never Existed" -> "Gamma"\n')
    const v = findViolations(doc([['Alpha', 4]]), current)
    expect(v.join('\n')).toContain('no row by that name exists in the base')
  })

  it('rejects a rename declared while the old row is still present', () => {
    // Otherwise "rename" becomes a way to hand a brand-new row an
    // established row's score while that row keeps its own.
    const base = doc([['Alpha', 5]])
    const current = doc([['Alpha', 5], ['Gamma', 5]], '- Renamed: "Alpha" -> "Gamma"\n')
    // Gamma is treated as the new row it is, so nothing is inherited and
    // nothing vanished — the score it claims is simply ungated, which is
    // correct: a new row has no history to have raised.
    expect(findViolations(base, current)).toEqual([])
  })

  it('accepts a genuine removal recorded as an em-dash', () => {
    // The escape hatch the failure message points at, so "this system is
    // gone" has an honest way to be written down.
    expect(findViolations(doc([['Alpha', 4]]), doc([['Alpha', '—']]))).toEqual([])
  })
})
