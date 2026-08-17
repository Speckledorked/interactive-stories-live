// scripts/__tests__/issueClosingKeywords.test.ts
//
// #453. The case that matters most is the FIRST one: the literal opening line
// of PR #452, which said it closed ten issues and closed one.
//
// The second thing this file has to get right is silence. A PR body routinely
// mentions issues it does not intend to close — "see #123", "split out of
// #445", "follow-up to #447" — and every one of those must pass. A check that
// fires on ordinary prose is a check that gets disabled, which is worse than
// not having one.

import { describe, it, expect } from 'vitest'
import { findSwallowedReferences, suggestedRewrite, CLOSING_KEYWORDS } from '../issueClosingKeywords'

describe('the bug this exists for (#453)', () => {
  it('catches PR #452\'s actual opening line', () => {
    const body = 'Closes #436, #437, #438, #439, #440, #441, #442, #443, #444, #445.\n\nTen commits.'

    const swallowed = findSwallowedReferences(body)

    expect(swallowed.map((s) => s.issue)).toEqual([437, 438, 439, 440, 441, 442, 443, 444, 445])
    // Every one of them names the reference that actually closed, so the
    // message can say "closes #436 only".
    expect(new Set(swallowed.map((s) => s.closes))).toEqual(new Set([436]))
  })

  it('reports nothing for the same list written correctly', () => {
    const body = 'Closes #436. Closes #437. Closes #438.'
    expect(findSwallowedReferences(body)).toEqual([])
  })

  it('accepts the mixed form GitHub actually honours', () => {
    // `Closes #1, closes #2` works — each number has its own keyword.
    expect(findSwallowedReferences('Closes #1, closes #2, closes #3')).toEqual([])
  })
})

describe('separators that mean "and this one too"', () => {
  it('catches a comma run', () => {
    expect(findSwallowedReferences('Fixes #10, #11')).toHaveLength(1)
  })

  it('catches "and"', () => {
    expect(findSwallowedReferences('Resolves #10 and #11')).toHaveLength(1)
  })

  it('catches an Oxford comma before "and"', () => {
    expect(findSwallowedReferences('Closes #1, #2, and #3')).toHaveLength(2)
  })

  it('catches an ampersand', () => {
    expect(findSwallowedReferences('Fixed #7 & #8')).toHaveLength(1)
  })

  it('catches a semicolon', () => {
    expect(findSwallowedReferences('Closes #7; #8')).toHaveLength(1)
  })
})

describe('silence on everything that is not this bug', () => {
  it('ignores a bare mention with no keyword anywhere', () => {
    expect(findSwallowedReferences('This builds on #123 and #124.')).toEqual([])
  })

  it('ignores a mention after a sentence break', () => {
    // A full stop ends the closing statement, so the next reference is prose.
    expect(findSwallowedReferences('Closes #1. See also #2, #3 for context.')).toEqual([])
  })

  it('ignores a mention on a following line', () => {
    expect(findSwallowedReferences('Closes #1\n\nRelated: #2, #3')).toEqual([])
  })

  it('ignores prose between two references', () => {
    expect(
      findSwallowedReferences('Closes #1, which was reported alongside #2 but is separate.')
    ).toEqual([])
  })

  it('ignores a table of commits that happens to cite issue numbers', () => {
    // PR #452's body had exactly this: a markdown table mapping commits to
    // issues, well after the closing line.
    const body = 'Closes #436.\n\n| Commit | Issue |\n|---|---|\n| `abc1234` | #436 #444 |\n'
    expect(findSwallowedReferences(body)).toEqual([])
  })

  it('does not fire on its own worked example inside a code fence', () => {
    // The documentation for this check, and any CONTRIBUTING guidance about
    // it, will contain the broken pattern as an example. A check that flags
    // its own explanation is a check people turn off.
    const body = [
      'Explaining the rule:',
      '',
      '```',
      'Closes #1, #2, #3   <- wrong, closes #1 only',
      '```',
      '',
      'Closes #99.',
    ].join('\n')
    expect(findSwallowedReferences(body)).toEqual([])
  })

  it('is silent on a body with no references at all', () => {
    expect(findSwallowedReferences('A refactor with no linked issue.')).toEqual([])
  })
})

describe('reference forms GitHub accepts', () => {
  it('handles the cross-repo form', () => {
    const swallowed = findSwallowedReferences('Closes owner/repo#10, owner/repo#11')
    expect(swallowed.map((s) => s.issue)).toEqual([11])
  })

  it('handles the full-URL form', () => {
    const body = 'Closes https://github.com/o/r/issues/10, https://github.com/o/r/issues/11'
    expect(findSwallowedReferences(body).map((s) => s.issue)).toEqual([11])
  })

  it('accepts a colon after the keyword', () => {
    expect(findSwallowedReferences('Closes: #1, #2')).toHaveLength(1)
  })

  it('is case-insensitive on the keyword', () => {
    expect(findSwallowedReferences('CLOSES #1, #2')).toHaveLength(1)
    expect(findSwallowedReferences('fixes #1, #2')).toHaveLength(1)
  })

  it('recognises every keyword GitHub does', () => {
    // Spelled out here rather than iterated from CLOSING_KEYWORDS, and that
    // is the entire point of this test.
    //
    // The first draft looped over the module's own array, which made it
    // tautological: deleting 'resolved' from CLOSING_KEYWORDS made the loop
    // one iteration shorter and the suite stayed green. Caught by mutation-
    // testing this file — the same defect #444 is about, in the check written
    // to catch that class of defect. An expectation derived from the thing
    // under test is not an expectation.
    //
    // This list is GitHub's, from the linked docs, and has to be maintained by
    // hand against them. A keyword this check does not know is a closing
    // statement it cannot see.
    const GITHUB_KEYWORDS = [
      'close', 'closes', 'closed',
      'fix', 'fixes', 'fixed',
      'resolve', 'resolves', 'resolved',
    ]

    for (const keyword of GITHUB_KEYWORDS) {
      expect(
        findSwallowedReferences(`${keyword} #1, #2`),
        `"${keyword}" was not recognised as a closing keyword`
      ).toHaveLength(1)
    }
    // And the module must not be carrying keywords GitHub does not honour,
    // which would make it fire on prose GitHub ignores.
    expect([...CLOSING_KEYWORDS].sort()).toEqual([...GITHUB_KEYWORDS].sort())
  })

  it('does not treat a near-miss word as a keyword', () => {
    // "addresses" and "closing" are not closing keywords; GitHub ignores them,
    // so flagging a run after one would be a false positive.
    expect(findSwallowedReferences('Addresses #1, #2')).toEqual([])
    expect(findSwallowedReferences('Closing in on #1, #2')).toEqual([])
  })
})

describe('the suggested rewrite', () => {
  it('gives a form that actually closes every issue', () => {
    const rewrite = suggestedRewrite('closes', [1, 2, 3])
    expect(rewrite).toBe('Closes #1. Closes #2. Closes #3.')
    // The suggestion has to survive its own check, or the message tells the
    // author to write something this gate would reject.
    expect(findSwallowedReferences(rewrite)).toEqual([])
  })

  it('preserves the author\'s tense', () => {
    expect(suggestedRewrite('fixed', [5])).toBe('Fixed #5.')
  })
})
