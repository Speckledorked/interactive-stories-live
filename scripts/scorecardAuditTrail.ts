// scripts/scorecardAuditTrail.ts
//
// The pure half of docs/ARCHITECTURE.md's "Scorecard Audit Log" gate: parse
// two versions of the doc, return the violations. No git, no filesystem, no
// process.exit — `check-scorecard-audit-trail.ts` owns all of that.
//
// #443: this split exists because the gate itself was the least-tested code
// in the repo and had degraded twice without anyone noticing. It is the one
// check whose whole job is to catch an agent grading its own work up, so a
// silent failure in it is worth more than a silent failure almost anywhere
// else — and both times, the bug was in exactly the branch that decides
// whether to fail. Everything below is now covered by
// scripts/__tests__/scorecardAuditTrail.test.ts, including the two bypasses
// that shipped.

/** System name -> score. Non-numeric scores (e.g. "—" for a removed/decided
 * row) are stored as null and never treated as an "increase" either way. */
export function parseScorecard(content: string): Map<string, number | null> {
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
export function parseCleanAuditEntries(content: string): Set<string> {
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

/**
 * #372: declared renames. #397 made a renamed row fail unconditionally,
 * which closed a real bypass (a rename used to carry any score across
 * unchecked) but also made row names permanently frozen — a row whose
 * subject genuinely changed shape could never be relabelled honestly.
 *
 * A rename is now declarable in the Audit Log:
 *
 *     - Renamed: "Old row name" -> "New row name"
 *
 * and the check still does the work: the new row inherits the OLD row's
 * score for comparison, so a rename that also raises the number needs the
 * same clean-adversarial-pass entry any other raise would. A rename alone
 * proves nothing and is therefore allowed to prove nothing.
 *
 * Returns new name -> old name.
 */
export function parseDeclaredRenames(content: string): Map<string, string> {
  const renames = new Map<string, string>()
  const sectionMatch = content.match(/## Scorecard Audit Log\n([\s\S]*?)(?=\n## |$)/)
  if (!sectionMatch) return renames

  const re = /^\s*[-*]\s*Renamed:\s*["“]([^"”]+)["”]\s*(?:->|→)\s*["“]([^"”]+)["”]\s*$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(sectionMatch[1]))) {
    renames.set(m[2].trim(), m[1].trim())
  }
  return renames
}

/**
 * Every reason this pair of doc versions should fail the gate, as
 * human-readable lines. Empty means it passes.
 */
export function findViolations(baseContent: string, currentContent: string): string[] {
  const baseScores = parseScorecard(baseContent)
  const currentScores = parseScorecard(currentContent)
  const cleared = parseCleanAuditEntries(currentContent)
  const renames = parseDeclaredRenames(currentContent)

  const violations: string[] = []

  // #443: check for DISAPPEARED rows by IDENTITY, before looking at any
  // individual score.
  //
  // #397 asked the question backwards — "did the row count fail to grow?" as
  // a proxy for "did a row disappear?" — and that proxy is defeated by
  // renaming one row and adding another in the same commit: the sizes come
  // out equal, every appearing row takes the "brand-new rows are never
  // gated" skip, and the renamed row carries its score across unchecked. It
  // also blamed the wrong rows, since a genuinely new row appearing
  // alongside an undeclared rename inherited the rename's accusation.
  //
  // Asking which NAMES vanished answers the actual question once, and points
  // at the row that actually moved.
  const vanished = [...baseScores.keys()].filter((name) => {
    if (currentScores.has(name)) return false
    // Accounted for by a declared rename whose new row is actually present.
    for (const [newName, oldName] of renames) {
      if (oldName === name && currentScores.has(newName)) return false
    }
    return true
  })
  if (vanished.length > 0) {
    violations.push(
      `row(s) present in the base are gone under that name now: ${vanished.join(', ')}. ` +
      `A row cannot simply disappear — that is what an undeclared rename looks like, and ` +
      `a brand-new row is never gated. If renamed, declare it in the Audit Log as: ` +
      `- Renamed: "old name" -> "new name". If the system is genuinely gone, keep the row ` +
      `and set its score to "—".`
    )
  }

  for (const [system, currentScore] of currentScores) {
    if (currentScore === null) continue
    let baseScore = baseScores.get(system)

    // #372: a declared rename resolves to the OLD row's score, so the
    // comparison below is the same one every other row gets. Only accepted
    // when the old name is genuinely gone — declaring a rename while both
    // rows still exist would be a way to give a brand-new row a score it
    // never earned.
    const oldName = renames.get(system)
    if (baseScore === undefined && oldName !== undefined && !currentScores.has(oldName)) {
      const inherited = baseScores.get(oldName)
      if (inherited === undefined) {
        violations.push(
          `"${system}": declared as a rename of "${oldName}", but no row by that name exists in the base`
        )
        continue
      }
      baseScore = inherited
    }

    if (baseScore === null) continue // was non-numeric — not a "raise"
    // A row with no base entry and no declared rename is genuinely new;
    // there is no prior score it could have raised. An undeclared rename
    // does not reach here silently — the vanished-name check above already
    // failed the run, naming the row that actually moved.
    if (baseScore === undefined) continue
    if (currentScore > baseScore && !cleared.has(system)) {
      violations.push(`"${system}": ${baseScore} -> ${currentScore}, no matching "0 new defects found" entry`)
    }
  }

  return violations
}
