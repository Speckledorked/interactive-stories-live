// src/lib/game/storyLogConsolidation.ts
// One-time cleanup for Story Log rows written before the duplicate-per-
// exchange bug was fixed (see sceneResolver.ts's generateCampaignLog) -
// that fix stops new duplicates going forward, but doesn't touch rows
// already sitting in the table, one per exchange instead of one per
// scene. Used by the Story Log "Regenerate All" maintenance action.

export interface ConsolidatableLogRow {
  id: string
  sceneId: string | null
  turnNumber: number
  highlights: string[]
}

export interface ConsolidationPlan {
  sceneId: string
  canonicalId: string
  deleteIds: string[]
  mergedHighlights: string[]
}

const MAX_HIGHLIGHTS_PER_SCENE = 8

/**
 * Group scene-type Story Log rows by sceneId and, for any scene with more
 * than one row, plan how to collapse them into one: keep the earliest
 * row (lowest turnNumber) as canonical, delete the rest, and merge their
 * highlights (deduplicated). None of the old per-exchange summaries
 * individually covers the whole scene, so the canonical row's summary is
 * regenerated separately from Scene.sceneResolutionText, not derived
 * here. Pure and exported so it's unit-testable without a database.
 */
export function planLogConsolidation(entries: ConsolidatableLogRow[]): ConsolidationPlan[] {
  const bySceneId = new Map<string, ConsolidatableLogRow[]>()
  for (const entry of entries) {
    if (!entry.sceneId) continue
    const group = bySceneId.get(entry.sceneId)
    if (group) {
      group.push(entry)
    } else {
      bySceneId.set(entry.sceneId, [entry])
    }
  }

  const plans: ConsolidationPlan[] = []
  for (const [sceneId, group] of bySceneId) {
    if (group.length <= 1) continue

    const sorted = group.slice().sort((a, b) => a.turnNumber - b.turnNumber)
    const [canonical, ...duplicates] = sorted
    const mergedHighlights = Array.from(new Set(sorted.flatMap(e => e.highlights)))
      .slice(0, MAX_HIGHLIGHTS_PER_SCENE)

    plans.push({
      sceneId,
      canonicalId: canonical.id,
      deleteIds: duplicates.map(d => d.id),
      mergedHighlights
    })
  }
  return plans
}
