// scripts/check-for-regression.ts
// Phase 5 CI entrypoint — the mechanical replacement for a human noticing
// a bad merge. Every auto-fix PR is labeled `fix:<checkKey>` on merge (see
// integrity-autofix.yml's diagnose-and-fix job); this asks GitHub which of
// those merged recently for the checkKey the workflow is about to act on,
// and hands them to the pure, unit-tested findRegression() to decide
// whether today's escalation is really that fix failing.
//
// #226 shortened the label prefix from `integrity-autofix:<checkKey>` to
// `fix:<checkKey>` (the original blew past GitHub's 50-character
// label-name limit for the longest registered checkKey) — this file's own
// `gh pr list --label` filter was never updated to match, so it queried a
// label no PR has ever actually carried since that rename. The practical
// effect: loadRecentMerges always returned [], findRegression always saw
// an empty candidate list and always returned null, and is_regression was
// unconditionally 'false' — the revert-on-regression path (see
// integrity-autofix.yml's revert-regression job) could never fire no
// matter what actually happened, silently defeating exactly the
// verification issue #89 asks for. Caught before that verification run,
// not after.
//
// Usage: npx tsx scripts/check-for-regression.ts <check-key>

import { execSync } from 'child_process'
import { appendFileSync } from 'fs'
import { findRegression, MergedAutofixRecord } from '../src/lib/game/integrity/regressionDetection'

interface GhMergedPr {
  number: number
  mergedAt: string
  mergeCommit: { oid: string } | null
}

function loadRecentMerges(checkKey: string): MergedAutofixRecord[] {
  const raw = execSync(
    `gh pr list --label "fix:${checkKey}" --state merged --json number,mergedAt,mergeCommit --limit 20`,
    { encoding: 'utf-8' }
  )
  const parsed = JSON.parse(raw) as GhMergedPr[]
  return parsed
    .filter((p) => p.mergeCommit)
    .map((p) => ({ checkKey, mergedAt: p.mergedAt, prNumber: p.number, commitSha: p.mergeCommit!.oid }))
}

function writeOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT
  if (file) {
    appendFileSync(file, `${name}<<EOF\n${value}\nEOF\n`)
  } else {
    console.log(`[output] ${name}=${value}`)
  }
}

function main() {
  const [checkKey] = process.argv.slice(2)
  if (!checkKey) {
    console.error('Usage: check-for-regression.ts <check-key>')
    process.exit(2)
  }

  const merges = loadRecentMerges(checkKey)
  const regression = findRegression(checkKey, merges)

  if (regression) {
    console.log(
      `REGRESSION: "${checkKey}" recurred after PR #${regression.prNumber} ` +
      `(merged ${regression.mergedAt}, commit ${regression.commitSha}) claimed to fix it`
    )
    writeOutput('is_regression', 'true')
    writeOutput('revert_sha', regression.commitSha)
    writeOutput('regression_pr', String(regression.prNumber))
  } else {
    console.log(`No prior merged auto-fix found for "${checkKey}" within the monitoring window — not a regression.`)
    writeOutput('is_regression', 'false')
  }
}

main()
