// scripts/issueClosingKeywords.ts
//
// #453: a pull request that says it closes ten issues has to actually close
// ten issues.
//
// PR #452's body opened with `Closes #436, #437, #438, #439, #440, #441,
// #442, #443, #444, #445`. It merged, and exactly ONE issue closed. The other
// nine sat open, looking like the work had not been done, until someone
// noticed and closed them by hand.
//
// GitHub's rule is that a closing reference is KEYWORD + ONE issue. A
// comma-separated run after a single keyword closes the first number and
// silently ignores the rest — no warning, no error, nothing in the merge
// result to indicate that nine references were dropped. The PR body reads as
// though it closed them; the issue list disagrees.
//
// That is the failure mode this repo keeps finding under a different name: a
// convention with a silent failure and no check. Same family as #424's
// dangling doc citations and #443's gate that could not fail. The difference
// here is that the artefact lives on GitHub rather than in the tree, so the
// check has to read the PR body from the event payload — but the DECISION is
// pure, and lives here so it can be tested from the failing side.
//
// Deliberately narrow: it only fires on a keyword followed by a run of bare
// references. A body that merely MENTIONS an issue it does not intend to
// close ("see #123", "split out of #445", "follow-up to #447") is normal and
// must stay silent, or the check becomes noise and gets ignored.

/**
 * GitHub's closing keywords, all three tenses of each.
 * https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue
 */
export const CLOSING_KEYWORDS = [
  'close', 'closes', 'closed',
  'fix', 'fixes', 'fixed',
  'resolve', 'resolves', 'resolved',
] as const

export interface SwallowedReference {
  /** The issue number that will NOT close. */
  issue: number
  /** The keyword whose scope it looked like it was in. */
  keyword: string
  /** The reference that keyword actually closes. */
  closes: number
}

/**
 * Code — fenced blocks AND inline spans — is blanked before scanning.
 *
 * This is a correctness rule, not a convenience. GitHub does not autolink an
 * issue reference inside code, and a reference it does not link is a reference
 * it cannot close. So a closing keyword inside code is quoted text about a
 * closing statement, never one itself.
 *
 * The inline half was missing in the first draft, and this gate caught it on
 * its own pull request: #454's body describes the bug in prose (``opened
 * `Closes #436, #437, ...` ``) and tabulates accepted and rejected forms as
 * inline code. Both tripped it. The fenced case had a test and a comment
 * reasoning about exactly this hazard — "a check that fires on its own worked
 * example is a check people turn off" — and I then wrote the documentation
 * using the other kind of code span.
 *
 * Replaced with spaces rather than removed: the scan works on offsets, so the
 * text has to keep its length.
 */
function stripCode(body: string): string {
  const blank = (block: string) => block.replace(/[^\n]/g, ' ')
  return body
    .replace(/```[\s\S]*?```/g, blank)
    // Inline spans, one or more backticks, never crossing a line — a code
    // span cannot contain a blank line, and not crossing newlines keeps an
    // unmatched stray backtick from blanking the rest of the body.
    .replace(/`+[^`\n]*`+/g, blank)
}

/** `#123`, `owner/repo#123`, and the full-URL form, with their positions. */
interface Reference {
  issue: number
  start: number
  end: number
}

function findReferences(body: string): Reference[] {
  const refs: Reference[] = []
  const re = /(?:[\w.-]+\/[\w.-]+)?#(\d+)\b|https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d+)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    refs.push({ issue: Number(m[1] ?? m[2]), start: m.index, end: m.index + m[0].length })
  }
  return refs
}

/** True when a reference is immediately preceded by its own closing keyword. */
function keywordBefore(body: string, refStart: number): string | null {
  // Allow the separator GitHub allows — whitespace, and an optional colon.
  const before = body.slice(Math.max(0, refStart - 40), refStart)
  const m = before.match(new RegExp(`\\b(${CLOSING_KEYWORDS.join('|')})\\b\\s*:?\\s*$`, 'i'))
  return m ? m[1] : null
}

/**
 * Only these separators mean "and this one too" — i.e. the author clearly
 * intended the following reference to be part of the same closing statement.
 * Anything else (a full stop, a newline, prose) starts a new thought and the
 * following reference is an ordinary mention.
 *
 * The bare-whitespace branch was missing, and #452 is the proof it matters:
 * its PR body used the comma form, but its MERGE COMMIT used spaces —
 * `Closes #436 #437 #438 ... #445` — and nine issues stayed open either way.
 * GitHub drops everything after the first reference regardless of which
 * separator joins them, so a gate that only knew about commas passed the very
 * string the incident was written in. Found by re-reading that merge commit
 * while the gate sat green on this PR awaiting merge.
 *
 * Horizontal whitespace only, never a newline: a reference at the start of the
 * next line is a new line item, not a continuation, and treating it as one
 * would flag ordinary "Related:" lists.
 */
const CONTINUATION = /^(?:[ \t]+|[\s]*(?:,|,?\s*(?:and|&|plus)|;)[\s]*)$/i

/**
 * Issue references that LOOK like they are part of a closing statement but
 * will not close.
 *
 * Walks each closing keyword's reference, then follows the chain of bare
 * references joined to it by a continuation separator. Every link in that
 * chain after the first is swallowed.
 */
export function findSwallowedReferences(body: string): SwallowedReference[] {
  const text = stripCode(body)
  const refs = findReferences(text)
  const swallowed: SwallowedReference[] = []

  for (let i = 0; i < refs.length; i++) {
    const keyword = keywordBefore(text, refs[i].start)
    if (!keyword) continue

    // This one closes. Follow the chain of bare references after it.
    let previous = refs[i]
    for (let j = i + 1; j < refs.length; j++) {
      const between = text.slice(previous.end, refs[j].start)
      if (!CONTINUATION.test(between)) break
      // A reference with its OWN keyword is correctly written; it ends the
      // run rather than being swallowed by it.
      if (keywordBefore(text, refs[j].start)) break

      swallowed.push({ issue: refs[j].issue, keyword, closes: refs[i].issue })
      previous = refs[j]
    }
  }

  return swallowed
}

/**
 * The corrected form, for the failure message. Showing the fix is most of
 * the value: the rule is not obvious and nobody reads a linked doc mid-merge.
 */
export function suggestedRewrite(keyword: string, issues: number[]): string {
  const cap = keyword.charAt(0).toUpperCase() + keyword.slice(1)
  return issues.map((n) => `${cap} #${n}.`).join(' ')
}
