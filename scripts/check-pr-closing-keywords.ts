// scripts/check-pr-closing-keywords.ts
// #453: fails a pull request whose closing references will not all close.
//
// See issueClosingKeywords.ts for what happened and why. This half only reads
// the body and sets the exit code; the decision is pure and tested there.
//
// Usage (CI):   PR_BODY="$(cat body.txt)" npx tsx scripts/check-pr-closing-keywords.ts
// Usage (hand): PR_BODY='Closes #1, #2' npx tsx scripts/check-pr-closing-keywords.ts

import { findSwallowedReferences, suggestedRewrite } from './issueClosingKeywords'

function main() {
  const body = process.env.PR_BODY

  if (body === undefined) {
    // A gate that cannot run has not passed — #443's rule, applied here.
    // Distinguishing "no body variable" (misconfigured workflow) from "empty
    // body" (a real, legal PR) is the whole point: the first is a broken
    // check, the second is nothing to check.
    console.error(
      'PR_BODY is not set. This check reads the pull request body from the ' +
      'event payload; without it there is nothing to examine, and passing ' +
      'would report a green check for a run that examined nothing.'
    )
    process.exit(1)
  }

  if (body.trim() === '') {
    console.log('Pull request body is empty — no closing references to check.')
    process.exit(0)
  }

  const swallowed = findSwallowedReferences(body)
  if (swallowed.length === 0) {
    console.log('Closing-reference check passed — every issue reference that reads as a closing reference will close.')
    process.exit(0)
  }

  // Group by the keyword occurrence they belong to, so the suggested rewrite
  // covers the whole run rather than one number at a time.
  const byRun = new Map<string, { keyword: string; issues: number[] }>()
  for (const s of swallowed) {
    const key = `${s.keyword}:${s.closes}`
    const run = byRun.get(key) ?? { keyword: s.keyword, issues: [s.closes] }
    run.issues.push(s.issue)
    byRun.set(key, run)
  }

  console.error(
    `This pull request names ${swallowed.length} issue reference(s) that read as closing ` +
    `references but will NOT close.\n\n` +
    `GitHub closes KEYWORD + ONE issue. A comma-separated run after a single keyword ` +
    `closes the first number and silently drops the rest — which is how PR #452 said it ` +
    `closed ten issues, closed one, and left nine open with no warning anywhere.\n`
  )
  for (const { keyword, issues } of byRun.values()) {
    const dropped = issues.slice(1)
    console.error(`  "${keyword} #${issues[0]}" closes #${issues[0]} only.`)
    console.error(`    dropped: ${dropped.map((n) => `#${n}`).join(', ')}`)
    console.error(`    write:   ${suggestedRewrite(keyword, issues)}\n`)
  }
  console.error(
    'If a reference was never meant to close its issue, keep it but move it out of the ' +
    'closing sentence — "see #123" and "follow-up to #123" are ignored by this check.'
  )
  process.exit(1)
}

main()
