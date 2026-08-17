// scripts/check-fixed-issues-closed.ts
// #453: reports Fix Log entries whose issue is still open.
//
// See fixLogIssues.ts for what this is and why it runs on a schedule rather
// than as a per-PR gate. This half does the network call and the exit code.
//
// Usage: GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo npx tsx scripts/check-fixed-issues-closed.ts

import { readFileSync } from 'fs'
import { parseFixLogIssues, findDivergence } from './fixLogIssues'

const DOC_PATH = 'docs/ARCHITECTURE.md'

/**
 * Every OPEN issue number in the repository.
 *
 * One paginated list rather than a lookup per Fix Log entry — the repo has a
 * handful of open issues against hundreds of closed ones, so this is a couple
 * of requests instead of ~60.
 *
 * Pull requests come back from this endpoint too and are filtered out: a PR
 * that happens to share a number with a Fix Log entry would otherwise read as
 * an open issue.
 */
async function fetchOpenIssues(repo: string, token: string): Promise<Set<number>> {
  const open = new Set<number>()
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues?state=open&per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    )
    if (!res.ok) {
      throw new Error(`GitHub API returned ${res.status} ${res.statusText} for page ${page}`)
    }
    const batch = (await res.json()) as Array<{ number: number; pull_request?: unknown }>
    for (const item of batch) {
      if (item.pull_request) continue
      open.add(item.number)
    }
    if (batch.length < 100) return open
  }
  // Ten pages of open issues means something is wrong with the assumption
  // this check is built on, and silently truncating would under-report.
  throw new Error('More than 1000 open issues — refusing to report on a truncated list.')
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY
  const token = process.env.GITHUB_TOKEN

  // Same fail-closed posture as #443: a check that cannot run has not passed.
  if (!repo || !token) {
    console.error(
      'GITHUB_REPOSITORY and GITHUB_TOKEN are both required. Without them this check ' +
      'cannot read issue state, and exiting 0 would report a green check for a ' +
      'comparison that never happened.'
    )
    process.exit(1)
  }

  const entries = parseFixLogIssues(readFileSync(DOC_PATH, 'utf-8'))
  if (entries.length === 0) {
    console.error(
      `Found no Fix Log entries with a trailing issue reference in ${DOC_PATH}. ` +
      'That is almost certainly a parsing failure rather than an empty Fix Log — ' +
      'failing rather than reporting "nothing to check".'
    )
    process.exit(1)
  }

  const open = await fetchOpenIssues(repo, token)
  const diverged = findDivergence(entries, open)

  if (diverged.length === 0) {
    console.log(`Fix Log check passed — all ${entries.length} referenced issue(s) are closed.`)
    process.exit(0)
  }

  console.error(
    `${diverged.length} issue(s) are described as fixed in ${DOC_PATH}'s Fix Log but are ` +
    `still OPEN:\n`
  )
  for (const d of diverged) {
    console.error(`  #${d.issue}${d.row ? `  (${d.row})` : ''}`)
    console.error(`    ${d.excerpt}…\n`)
  }
  console.error(
    'Either the fix did not actually land, or the issue needs closing. The second is ' +
    'the common case and the reason this check exists: a comma-separated "Closes #1, #2" ' +
    'in a merged PR closes only the first, so the rest stay open while the Fix Log says ' +
    'otherwise (see #453).'
  )
  process.exit(1)
}

main().catch((error) => {
  console.error('Fix Log issue check failed to run:', error)
  process.exit(1)
})
