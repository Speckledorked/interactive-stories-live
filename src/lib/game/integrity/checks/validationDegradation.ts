// src/lib/game/integrity/checks/validationDegradation.ts
//
// Not a structural check — see checkRegistry.ts's "closed catalogue of
// structural-tier checks (Phase 1)" framing, which this deliberately
// doesn't join. The 11 registered checkKeys all ask "does this stored
// value point at something real, right now"; this asks a different
// question — "has the AI's response been silently degrading lately" —
// answered from WorldMeta.aiMetrics.requestHistory (already recorded by
// cost-tracker.ts on every scene resolution) rather than from a snapshot
// of stored world-entity data. There's no single entity to pin a
// Violation on, and nothing here for a repair function to fix — the bug,
// if there is one, lives in the AI/validation code, not in a database
// row — so this intentionally stays outside IntegrityCheck's per-entity
// Violation/Repair/escalation machinery. It's computed and attached to
// the report separately, in persistReport.ts, where WorldMeta.aiMetrics
// is already being read.

export const VALIDATION_DEGRADATION_WINDOW = 10
export const VALIDATION_DEGRADATION_RATE_THRESHOLD = 0.3

export interface ValidationDegradation {
  window: number
  sampleSize: number
  degradedCount: number
  rate: number
  degraded: boolean
}

interface RequestHistoryEntry {
  requestType?: unknown
  validationLevel?: unknown
}

/**
 * Pure. Reads the tail of a campaign's aiMetrics.requestHistory (already
 * capped at 50 entries campaign-wide by cost-tracker.ts) and flags when
 * more than VALIDATION_DEGRADATION_RATE_THRESHOLD of the last
 * VALIDATION_DEGRADATION_WINDOW scene-resolution calls fell through to
 * 'partial' or 'emergency' validation instead of 'full'. Returns null when
 * there isn't yet a full window of scene-resolution history to judge —
 * "not enough signal", not "healthy".
 */
export function detectValidationDegradation(requestHistory: unknown): ValidationDegradation | null {
  if (!Array.isArray(requestHistory)) return null

  const sceneResolutions = (requestHistory as RequestHistoryEntry[]).filter(
    (entry) => entry?.requestType === 'scene_resolution'
  )
  const recent = sceneResolutions.slice(-VALIDATION_DEGRADATION_WINDOW)
  if (recent.length < VALIDATION_DEGRADATION_WINDOW) return null

  const degradedCount = recent.filter((entry) => entry?.validationLevel !== 'full').length
  const rate = degradedCount / recent.length

  return {
    window: VALIDATION_DEGRADATION_WINDOW,
    sampleSize: recent.length,
    degradedCount,
    rate,
    degraded: rate > VALIDATION_DEGRADATION_RATE_THRESHOLD,
  }
}
