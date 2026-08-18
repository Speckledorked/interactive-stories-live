// scripts/migrationImmutability.ts
//
// A merged migration file must never be edited again.
//
// ## The incident this exists for
//
// 20260816090000_world_turn_integrity applied to production on
// 2026-08-16T06:50:45. Three later pull requests then APPENDED statements to
// that same file rather than adding migrations of their own.
//
// `prisma migrate deploy` keys on the migration NAME. Once a name is in
// _prisma_migrations it is never run again, and deploy does NOT fail on a
// checksum mismatch — it prints "All migrations have been successfully
// applied" and moves on. So the appended statements ran everywhere that
// builds a database from the current files (CI, fresh local databases) and
// never ran in production.
//
// The result was invisible for a day and a half: CI green the whole time,
// because CI's database is always built from the files as they stand. The
// symptom was every campaign detail page returning an error, because
// /api/campaigns/[id] selects WorldMeta and Postgres rejected the column list
// with P2022 for a column the migration history said existed.
//
// ## Why this check and not a database one
//
// The migration-drift check added in #455 compares the migration history to
// schema.prisma on a FRESH database. It cannot see this: the files are
// self-consistent, and a fresh database built from them is correct. The thing
// that had drifted was production, against a history that had been rewritten
// underneath it.
//
// Checking production directly would need production credentials in CI. This
// needs nothing but git: if a migration file is never edited after the commit
// that introduced it, no already-applied migration can silently change
// meaning. That is the invariant, and it is decidable from history alone.
//
// The pure half lives here so the decision is testable without a repository.

/** One migration file and the commits that have touched it. */
export interface MigrationHistory {
  name: string
  /** Commit SHAs touching this file, newest first (git log order). */
  commits: string[]
}

export interface Violation {
  name: string
  commitCount: number
  reason: string
}

/**
 * Migrations edited after they were applied, before this check existed.
 *
 * Both are recorded rather than quietly tolerated, with what the edit did,
 * because "this file was rewritten after production ran it" is exactly the
 * fact someone debugging a P2022 needs and will not otherwise find.
 *
 * An entry here is NOT permission to edit that file again. It is a statement
 * that the damage is already done and has been dealt with separately — and
 * the check below still fails if a NEW commit touches one of them, because
 * the recorded commit count is part of the allowance.
 */
export const KNOWN_EDITED: Record<string, { commits: number; note: string }> = {
  '20260816090000_world_turn_integrity': {
    commits: 4,
    note:
      'Edited by 3 later PRs after production applied it 2026-08-16T06:50. The appended ' +
      'tail (CampaignCapability.isNarrated, campaign_memories.archivedAt/consolidatedIntoId ' +
      'and its index, WorldMeta.lastTickCapReport, two backfills) never ran in production ' +
      'and broke every campaign page with P2022. Replayed by ' +
      '20260817230000_repair_world_turn_integrity_tail.',
  },
  '20260816140000_capability_prerequisite_dag': {
    commits: 2,
    note:
      'Also edited after production applied it, but the appended lines are COMMENTS only — ' +
      'no DDL, so no functional drift. Verified by diffing the applied version (matched by ' +
      'checksum) against the current file. Recorded anyway: the checksum diverged, and a ' +
      'diverged checksum is the signal this check exists to preserve.',
  },
}

/**
 * Migration files touched by more than the commit that introduced them.
 *
 * A file appearing in exactly one commit is the healthy case. More than one
 * means it was rewritten after it was merged — and possibly after it was
 * applied somewhere that will now never re-run it.
 */
export function findViolations(
  histories: MigrationHistory[],
  known: Record<string, { commits: number; note: string }> = KNOWN_EDITED
): Violation[] {
  const out: Violation[] = []
  for (const h of histories) {
    if (h.commits.length <= 1) continue
    const allowance = known[h.name]
    if (allowance && h.commits.length <= allowance.commits) continue
    out.push({
      name: h.name,
      commitCount: h.commits.length,
      reason: allowance
        ? `edited again: ${h.commits.length} commits now, ${allowance.commits} recorded as known`
        : 'edited after the commit that introduced it',
    })
  }
  return out
}

/**
 * Allowlist entries whose file is no longer edited as recorded.
 *
 * Same self-pruning idea as readmeSymbols' deliberately-absent list: if a
 * recorded exception stops being true, it has to come out, or the list
 * decays into a suppression file nobody audits.
 */
export function findStaleAllowances(
  histories: MigrationHistory[],
  known: Record<string, { commits: number; note: string }> = KNOWN_EDITED
): string[] {
  const byName = new Map(histories.map((h) => [h.name, h.commits.length]))
  const stale: string[] = []
  for (const name of Object.keys(known)) {
    const actual = byName.get(name)
    if (actual === undefined) {
      stale.push(`${name}: no longer present in prisma/migrations`)
    } else if (actual < known[name].commits) {
      stale.push(`${name}: recorded ${known[name].commits} commits, now ${actual}`)
    }
  }
  return stale
}
