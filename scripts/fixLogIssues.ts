// scripts/fixLogIssues.ts
//
// #453: an issue the docs describe as FIXED should not still be open.
//
// The inverse of the closing-keyword bug, and the same underlying gap: the
// tree and the issue tracker are two records of the same fact, and nothing
// compares them. For about an hour after PR #452 merged, ARCHITECTURE.md's
// Fix Log described ten defects in the past tense while all ten issues sat
// open — the docs and the tracker disagreed and neither knew.
//
// This is DRIFT DETECTION, not a gate, and the distinction decides where it
// runs. On a pull request the issue being fixed is still open by definition
// (it closes on merge), so a per-PR gate would fail on every fix. On
// push-to-main it races GitHub's own processing of the closing keyword. So it
// runs on a schedule, where there is no race and the thing it measures —
// divergence that has persisted — is exactly what a daily check is for.
//
// The parsing and the comparison are pure and live here. The network call
// lives in check-fixed-issues-closed.ts, injected, so this half is testable
// without a token.

/** A Fix Log entry's issue reference. */
export interface FixLogEntry {
  issue: number
  /** The Scorecard row the entry attributes itself to, for the message. */
  row: string | null
  /** First ~80 chars of the entry, so a failure is identifiable at a glance. */
  excerpt: string
}

/**
 * Issue numbers the Fix Log claims are fixed.
 *
 * Scoped to the `## Fix Log` section and to the trailing-reference shape the
 * section actually uses — `… *(Scorecard row)* #288` — rather than every
 * `#NNN` in the file. That matters: ARCHITECTURE.md mentions ~138 distinct
 * issue numbers, most of them mid-sentence as context ("the gap #279 named",
 * "superseded by #375"), and a mid-sentence mention is not a claim that the
 * issue is closed. Only the trailing attribution is.
 */
export function parseFixLogIssues(doc: string): FixLogEntry[] {
  const start = doc.indexOf('## Fix Log')
  if (start === -1) return []
  const after = doc.indexOf('\n## ', start + 1)
  const section = after === -1 ? doc.slice(start) : doc.slice(start, after)

  const entries: FixLogEntry[] = []
  // Each bullet is one entry; entries wrap over many lines, so split on the
  // bullet marker rather than on newlines.
  for (const bullet of section.split(/\n(?=[-*] )/)) {
    // The trailing reference: optionally preceded by the *(Row name)* tag.
    const m = bullet.match(/(?:\*\(([^)]*)\)\*\s*)?#(\d+)\s*$/)
    if (!m) continue
    entries.push({
      issue: Number(m[2]),
      row: m[1]?.trim() ?? null,
      excerpt: bullet.replace(/^[-*]\s*/, '').replace(/\s+/g, ' ').slice(0, 80),
    })
  }
  return entries
}

export interface Divergence {
  issue: number
  row: string | null
  excerpt: string
}

/**
 * Fix Log entries whose issue is still open.
 *
 * Takes the OPEN set rather than querying per issue: the repo has a handful of
 * open issues and hundreds of closed ones, so one paginated list is far
 * cheaper than a lookup per entry — and it fails safe, because an issue
 * missing from the list is treated as closed rather than as a violation.
 */
export function findDivergence(entries: FixLogEntry[], openIssues: Set<number>): Divergence[] {
  const seen = new Set<number>()
  const out: Divergence[] = []
  for (const entry of entries) {
    if (!openIssues.has(entry.issue)) continue
    if (seen.has(entry.issue)) continue
    seen.add(entry.issue)
    out.push({ issue: entry.issue, row: entry.row, excerpt: entry.excerpt })
  }
  return out
}
