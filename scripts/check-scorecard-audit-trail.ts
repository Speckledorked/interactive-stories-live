// scripts/check-scorecard-audit-trail.ts
// Enforces docs/ARCHITECTURE.md's "Scorecard Audit Log" rule: a Scorecard
// row's score may only increase in the same commit that adds a matching
// Audit Log entry recording an adversarial pass that found zero new
// defects for that exact system. Built after a real user caught the
// self-scoring bias this exists to close — an agent fixing a named bug
// and then immediately grading its own work up, with no outside check,
// repeatedly across this project's history.
//
// Compares the current working tree's docs/ARCHITECTURE.md against the
// same file at HEAD^1 (the branch tip before this push/merge — correct
// for both a plain commit and a --no-ff merge commit, which is how this
// project's own workflow lands changes on main) or, on a pull_request
// event, against the PR's base branch.
//
// This file owns only the git/filesystem/exit-code half. The comparison
// itself lives in ./scorecardAuditTrail.ts so it can be tested without a
// repository — see that file's header for why (#443).
//
// Usage: npx tsx scripts/check-scorecard-audit-trail.ts

import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { findViolations } from './scorecardAuditTrail'

const DOC_PATH = 'docs/ARCHITECTURE.md'

/**
 * #397: compare against the MERGE BASE, not HEAD^1.
 *
 * HEAD^1 is the previous commit, so splitting a raise across two commits
 * defeated this entirely: commit A raises the score, commit B is a no-op,
 * and neither single diff shows an increase against its own parent. The
 * merge base is the point the branch diverged, so the comparison covers
 * the whole branch however many commits it took.
 */
function resolveBaseRef(): string {
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    const base = process.env.GITHUB_BASE_REF
    if (base) {
      try {
        return execSync(`git merge-base origin/${base} HEAD`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      } catch {
        return `origin/${base}`
      }
    }
  }
  // On a push to main, the merge base with the previous tip of main is the
  // right comparison for a --no-ff merge commit AND for a plain commit.
  try {
    return execSync('git merge-base HEAD^1 HEAD', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'HEAD^1'
  }
}

function loadFileAt(ref: string, path: string): string | null {
  try {
    return execSync(`git show ${ref}:${path}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

/**
 * #397: distinguishes "no base to compare" from "the base is unreachable".
 * Only the former is a legitimate skip.
 */
function isFirstCommitTouchingDoc(): boolean {
  // #443: a shallow clone makes this question unanswerable, so it must be
  // asked FIRST rather than inferred from a commit count that shallowness
  // itself corrupts.
  //
  // The count is 1 by construction in a shallow clone, so the old version
  // reported "first commit to touch it, nothing to compare" and exited 0 —
  // demonstrated in a real checkout. That is precisely the failure #397 set
  // out to close ("a gate that cannot run has not passed"): the escape
  // hatch exists to recognise a genuine first commit, and it could not tell
  // one from a misconfigured checkout.
  try {
    const shallow = execSync('git rev-parse --is-shallow-repository', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (shallow === 'true') return false
  } catch {
    // Old git without --is-shallow-repository, or not a repo at all. Either
    // way we cannot establish that history is complete, so we must not
    // claim this is the first commit.
    return false
  }

  try {
    const history = execSync(`git log --format=%H -- ${DOC_PATH}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return history.trim().split('\n').filter(Boolean).length <= 1
  } catch {
    return false
  }
}

function main() {
  const baseRef = resolveBaseRef()
  const baseContent = loadFileAt(baseRef, DOC_PATH)
  if (baseContent === null) {
    // #397: this used to `process.exit(0)` — so a shallow clone silently
    // disabled the check entirely, and CI reported green for a run that
    // examined nothing. A gate that cannot run has not passed.
    //
    // The one legitimate case is the first commit ever to touch the file,
    // which has no base to compare against. Everything else is a
    // misconfigured checkout, and the fix is `fetch-depth: 0`.
    if (isFirstCommitTouchingDoc()) {
      console.log(`${DOC_PATH} has no prior version — first commit to touch it, nothing to compare.`)
      process.exit(0)
    }
    console.error(
      `Could not read ${DOC_PATH} at ${baseRef}. This is almost always a shallow clone — ` +
      `set fetch-depth: 0 on the checkout step. Failing rather than skipping: a gate that ` +
      `cannot run has not passed.`
    )
    process.exit(1)
  }

  const violations = findViolations(baseContent, readFileSync(DOC_PATH, 'utf-8'))

  if (violations.length > 0) {
    console.error(`Scorecard audit trail check failed (vs. ${baseRef}):\n`)
    for (const v of violations) console.error(`  - ${v}`)
    console.error(`\nSee docs/ARCHITECTURE.md's "Scorecard Audit Log" section for the required entry format.`)
    process.exit(1)
  }

  console.log(`Scorecard audit trail check passed (compared against ${baseRef}).`)
}

main()
