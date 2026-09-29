// scripts/schemaDrift.ts
//
// Does the migration history actually add up to schema.prisma?
//
// Nothing compared those two records until this check existed, and every other
// check is blind to the disagreement by construction: `prisma generate` builds
// the client FROM schema.prisma so tsc typechecks against the intent; the unit
// suite is fully mocked so it never touches a real column; `prisma migrate
// deploy` only replays the migration files that exist. The first symptom is a
// live query against a column that was never created.
//
// ## Why this is a SNAPSHOT rather than "the diff must be empty"
//
// The honest answer is that an empty diff is unattainable here, and pretending
// otherwise would mean either a permanently red check or a silenced one.
//
// campaign_memories carries four indexes created in raw SQL:
//
//   USING hnsw (embedding vector_cosine_ops)      -- pgvector ANN index
//   USING GIN ("involvedCharacterIds")            -- and npcs, factions
//
// Prisma's schema language has no way to express an hnsw index at all (it
// supports Gin, Gist, Hash, Brin, SpGist — not the pgvector access methods),
// so `migrate diff` will report that index as missing from the datamodel
// forever, no matter what anyone writes in schema.prisma. That is a limitation
// of the tool, not drift.
//
// So the check records the residual difference explicitly, in
// prisma/schema-drift-expected.txt, and asserts the residual has not CHANGED.
// Anything new fails. That is the same ratchet shape as the lint warning
// ceiling, and the same principle as the readmeSymbols guard's list of
// deliberately-absent symbols: an exception that has to be written down, with
// a reason, is an exception someone can audit. A blanket "ignore indexes"
// would have hidden the two REAL findings this check produced on its first
// run — a column present in every database but missing from the model, and a
// unique index whose name Postgres had silently truncated.
//
// ## Failing on a STALE expectation matters as much as failing on new drift
//
// If an entry in the snapshot stops appearing, the check fails too. Otherwise
// the file would accumulate exceptions that no longer apply, and an exception
// list nobody prunes is how a check quietly stops asserting anything.

/** One line of `prisma migrate diff`'s human-readable summary. */
export type DiffLine = string

/**
 * Prisma's own noise, which is not part of the comparison.
 *
 * The CLI prints an "Update available" box drawn with box characters, and
 * blank lines separate table blocks. Neither says anything about the schema.
 */
function isNoise(line: string): boolean {
  if (line.trim() === '') return true
  // The version-nag box: ┌ │ └ ─ and the like.
  if (/^[\s┌│└├─┐┘]+$/.test(line)) return true
  if (/^[\s]*[│┌└]/.test(line)) return true
  return false
}

/** A table header line, e.g. "[*] Changed the `lore_entries` table". */
function tableOf(line: string): string | null {
  const match = line.match(/^\[.\] (?:Changed|Added|Removed) the `([^`]+)` table$/)
  return match ? match[1] : null
}

/**
 * Comparable form of a diff summary: meaningful lines, trimmed, QUALIFIED BY
 * THEIR TABLE, and sorted.
 *
 * Sorted deliberately. Prisma does not promise a stable order for the index
 * lines inside a table block, and a check that fails because two lines swapped
 * places would be a check people rerun until it passes — which is the same as
 * not having one.
 *
 * Qualified because sorting a flat list throws away the one thing that makes a
 * sub-line mean anything: which table it belongs to. That cost nothing while
 * campaign_memories was the only table in the residual. #499 added an hnsw
 * index to lore_entries, the schema's second pgvector column, and its diff line
 * is character-for-character identical:
 *
 *     [-] Removed index on columns (embedding)
 *
 * Against a flat set those two lines are one line. The snapshot would have gone
 * on passing with either index dropped, because the other still produced the
 * text — a check quietly asserting half of what it claims, which is the exact
 * failure mode this file's header warns about for stale exceptions.
 */
export function normalizeDiff(output: string): DiffLine[] {
  const qualified: DiffLine[] = []
  let table: string | null = null

  for (const raw of output.split('\n')) {
    if (isNoise(raw)) continue
    const line = raw.replace(/\s+$/, '').trimStart()
    if (line === '') continue

    const header = tableOf(line)
    if (header) {
      table = header
      qualified.push(line)
      continue
    }
    // A sub-line before any header keeps its bare form rather than being
    // dropped: an unattributed line is still drift, and silently discarding
    // it would be the same bug in the other direction.
    qualified.push(table ? `${table}: ${line}` : line)
  }

  return qualified.sort()
}

/** `No difference detected.` is prisma's way of saying the diff is empty. */
export function isEmptyDiff(lines: DiffLine[]): boolean {
  return lines.length === 0 || (lines.length === 1 && /^no difference detected/i.test(lines[0]))
}

export interface DriftComparison {
  /** In the real diff but not in the snapshot — new drift. */
  unexpected: DiffLine[]
  /** In the snapshot but no longer in the real diff — a stale exception. */
  stale: DiffLine[]
  ok: boolean
}

/**
 * Compare the live diff against the recorded residual.
 *
 * Both directions are failures, for different reasons: `unexpected` is drift
 * that just appeared, `stale` is an exception that has outlived its reason.
 */
export function compareDrift(actual: DiffLine[], expected: DiffLine[]): DriftComparison {
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  const unexpected = actual.filter((l) => !expectedSet.has(l))
  const stale = expected.filter((l) => !actualSet.has(l))
  return { unexpected, stale, ok: unexpected.length === 0 && stale.length === 0 }
}

/** The snapshot file's own comment lines are documentation, not diff content. */
export function parseExpected(fileContents: string): DiffLine[] {
  return normalizeDiff(
    fileContents
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n')
  )
}
