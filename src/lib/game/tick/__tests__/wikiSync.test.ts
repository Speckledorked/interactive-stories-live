// src/lib/game/tick/__tests__/wikiSync.test.ts
// WikiEntry.changelog (#90) — declared, initialized empty at creation, and
// never appended to by anything, so the wiki page's own
// `changelog.length > 0` display guard could never become true.

import { describe, it, expect } from 'vitest'
import { appendWikiChangelog, MAX_WIKI_CHANGELOG_ENTRIES } from '../wikiSync'

describe('appendWikiChangelog (#90)', () => {
  it('starts a changelog from nothing', () => {
    expect(appendWikiChangelog(null, 5, 'Details updated')).toEqual([{ turn: 5, change: 'Details updated' }])
    expect(appendWikiChangelog(undefined, 5, 'x')).toHaveLength(1)
  })

  it('appends to an existing changelog in order', () => {
    const first = appendWikiChangelog(null, 1, 'a')
    const second = appendWikiChangelog(first, 2, 'b')
    expect(second).toEqual([{ turn: 1, change: 'a' }, { turn: 2, change: 'b' }])
  })

  it('does not record the same no-op twice for the same turn', () => {
    // A tick can re-sync an unchanged entry; that shouldn't spam history.
    const first = appendWikiChangelog(null, 3, 'Details updated')
    const again = appendWikiChangelog(first, 3, 'Details updated')
    expect(again).toHaveLength(1)
  })

  it('does record the same text on a later turn', () => {
    const first = appendWikiChangelog(null, 3, 'Details updated')
    const later = appendWikiChangelog(first, 4, 'Details updated')
    expect(later).toHaveLength(2)
  })

  it('is bounded, dropping the oldest entries', () => {
    let log: any = null
    for (let turn = 1; turn <= MAX_WIKI_CHANGELOG_ENTRIES + 10; turn++) {
      log = appendWikiChangelog(log, turn, `change ${turn}`)
    }
    expect(log).toHaveLength(MAX_WIKI_CHANGELOG_ENTRIES)
    expect(log[log.length - 1].turn).toBe(MAX_WIKI_CHANGELOG_ENTRIES + 10)
    expect(log[0].turn).toBe(11)
  })

  it('ignores malformed prior content rather than throwing', () => {
    expect(appendWikiChangelog('not an array', 1, 'a')).toEqual([{ turn: 1, change: 'a' }])
    expect(appendWikiChangelog([null, { nope: true }], 1, 'a')).toEqual([{ turn: 1, change: 'a' }])
  })
})
