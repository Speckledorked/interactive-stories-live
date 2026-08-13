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
// Usage: npx tsx scripts/check-scorecard-audit-trail.ts

import { execSync } from 'child_process'
import { readFileSync } from 'fs'

const DOC_PATH = 'docs/ARCHITECTURE.md'

function resolveBaseRef(): string {
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    const base = process.env.GITHUB_BASE_REF
    if (base) return `origin/${base}`
  }
  return 'HEAD^1'
}

function loadFileAt(ref: string, path: string): string | null {
  try {
    return execSync(`git show ${ref}:${path}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

/** System name -> score. Non-numeric scores (e.g. "—" for a removed/decided
 * row) are stored as null and never treated as an "increase" either way. */
function parseScorecard(content: string): Map<string, number | null> {
  const scores = new Map<string, number | null>()
  const tableStart = content.indexOf('## Scorecard')
  const tableEnd = content.indexOf('## Scorecard Audit Log', tableStart)
  if (tableStart === -1) return scores
  const section = tableEnd === -1 ? content.slice(tableStart) : content.slice(tableStart, tableEnd)

  const rowRe = /^\|\s*([^|]+?)\s*\|\s*([0-9]|—)\s*\|/gm
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(section))) {
    const system = m[1].trim()
    if (system === 'System' || /^:?-+:?$/.test(system)) continue // header/separator rows
    const raw = m[2]
    scores.set(system, raw === '—' ? null : Number(raw))
  }
  return scores
}

/** System names with at least one Audit Log entry recording a clean
 * ("0 new defects found") adversarial pass. */
function parseCleanAuditEntries(content: string): Set<string> {
  const cleared = new Set<string>()
  const sectionMatch = content.match(/## Scorecard Audit Log\n([\s\S]*?)(?=\n## |$)/)
  if (!sectionMatch) return cleared

  const entries = sectionMatch[1].split(/\n(?=### )/)
  for (const entry of entries) {
    const heading = entry.match(/^### \d{4}-\d{2}-\d{2} — (.+)$/m)
    if (!heading) continue
    if (/0 new defects found/i.test(entry)) {
      cleared.add(heading[1].trim())
    }
  }
  return cleared
}

function main() {
  const baseRef = resolveBaseRef()
  const baseContent = loadFileAt(baseRef, DOC_PATH)
  if (baseContent === null) {
    console.log(`Could not read ${DOC_PATH} at ${baseRef} (shallow history, or first commit touching it) — nothing to compare against, skipping.`)
    process.exit(0)
  }

  const currentContent = readFileSync(DOC_PATH, 'utf-8')
  const baseScores = parseScorecard(baseContent)
  const currentScores = parseScorecard(currentContent)
  const cleared = parseCleanAuditEntries(currentContent)

  const violations: string[] = []
  for (const [system, currentScore] of currentScores) {
    if (currentScore === null) continue
    const baseScore = baseScores.get(system)
    if (baseScore === null || baseScore === undefined) continue // new row, or was non-numeric — not a "raise"
    if (currentScore > baseScore && !cleared.has(system)) {
      violations.push(`"${system}": ${baseScore} -> ${currentScore}, no matching "0 new defects found" entry`)
    }
  }

  if (violations.length > 0) {
    console.error(`Scorecard score(s) increased (vs. ${baseRef}) with no matching Audit Log entry:\n`)
    for (const v of violations) console.error(`  - ${v}`)
    console.error(`\nSee docs/ARCHITECTURE.md's "Scorecard Audit Log" section for the required entry format.`)
    process.exit(1)
  }

  console.log(`Scorecard audit trail check passed (compared against ${baseRef}).`)
}

main()
