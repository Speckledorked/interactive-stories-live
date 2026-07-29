// src/lib/game/integrity/regressionDetection.ts
// Phase 5 — the replacement for a human approval gate: since every fix now
// merges itself with nobody reviewing it first, the system has to watch
// its own past merges and notice when one didn't actually work. If a
// checkKey escalates again shortly after a merged auto-fix PR claimed to
// close it, that recurrence IS the proof the fix was wrong — the same
// escalation signal (escalation.ts) that flags a code defect in the first
// place, now pointed at this pipeline's own commits too.

export interface MergedAutofixRecord {
  checkKey: string
  mergedAt: string // ISO timestamp
  prNumber: number
  commitSha: string
}

/** Matches ESCALATION_LOOKBACK_DAYS — a recurrence has to be within the
 * same window escalation detection already uses, for the same reason:
 * long enough for a real recurrence to show up, short enough that an
 * unrelated new violation years later isn't mistaken for the same fix
 * failing. */
export const REGRESSION_MONITORING_DAYS = 14

/**
 * Pure: given every merged auto-fix PR on record for a checkKey, does
 * TODAY's escalation for that same checkKey look like that fix failing,
 * rather than a fresh, unrelated occurrence? Returns the most recent
 * qualifying merge (the fix presumed to have failed), or null if there's
 * nothing to revert.
 */
export function findRegression(
  checkKey: string,
  recentMerges: MergedAutofixRecord[],
  now: Date = new Date()
): MergedAutofixRecord | null {
  const cutoffMs = now.getTime() - REGRESSION_MONITORING_DAYS * 24 * 60 * 60 * 1000

  const candidates = recentMerges.filter(
    (m) => m.checkKey === checkKey && new Date(m.mergedAt).getTime() >= cutoffMs
  )
  if (candidates.length === 0) return null

  return candidates.sort((a, b) => new Date(b.mergedAt).getTime() - new Date(a.mergedAt).getTime())[0]
}
