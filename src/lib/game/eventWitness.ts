// src/lib/game/eventWitness.ts
// Information Latency / Canon-per-Viewer (#101), PR 3/3 — the prompt half.
//
// PR 1 wrote WITNESSED rows (a scene's participants, the instant a
// significant WorldEvent from that scene happens); PR 2 wrote TOLD rows
// (tickInformation, once a graph-derived propagation delay elapses).
// This is the pure grouping/capping step between "raw EventWitness rows
// joined against their WorldEvent.reason text" and what actually lands in
// a character's own block of the AI prompt — mirrors knowledge.ts's role
// for Character.knownConcepts, not a new mechanism of its own.
//
// No string-length truncation here: the assembled worldSummary already
// gets walked by contextManager.ts's clampPromptStrings, which caps every
// free-text field (WorldEvent.reason included) the same way regardless of
// where it came from. This only caps the ITEM COUNT per character per
// grade, the same discipline MAX_KNOWN_CONCEPTS applies to knownConcepts.

export const MAX_WITNESSED_EVENTS_IN_PROMPT = 6
export const MAX_TOLD_EVENTS_IN_PROMPT = 4

// Misinformation: a short qualifying clause baked onto a distorted TOLD
// line, keyed by EventWitnessDistortion (informationTick.ts's
// decideDistortion). Never applied to WITNESSED — ground truth, never
// distorted. Kept terse to match the existing "(rumor-grade, may be
// inaccurate)" register scenePrompt.ts already wraps every TOLD line in.
const DISTORTION_SUFFIXES: Record<string, string> = {
  EXAGGERATED: ' (this account sounds exaggerated)',
  MINIMIZED: ' (this account sounds downplayed)',
  GARBLED_DETAIL: ' (the details in this account seem garbled)',
  ATTRIBUTED_WRONG: ' (this account may have the wrong party involved)',
}

export interface WitnessRow {
  characterId: string
  grade: 'WITNESSED' | 'TOLD'
  turnNumber: number
  reason: string
  /** Only meaningful when grade is TOLD — WITNESSED is always false/null. */
  distorted?: boolean
  distortionFlavor?: string | null
}

export interface GroupedWitness {
  /** Most-recent-first, already capped at MAX_WITNESSED_EVENTS_IN_PROMPT. */
  witnessed: string[]
  /** Most-recent-first, already capped at MAX_TOLD_EVENTS_IN_PROMPT. */
  told: string[]
}

/**
 * Pure. Groups flat EventWitness+WorldEvent rows by character, splits by
 * grade, sorts most-recent-first, and caps each grade independently — a
 * character with many WITNESSED events isn't crowded out of their TOLD
 * rumors (or vice versa) by one grade's own volume.
 */
export function groupEventWitnessesForPrompt(rows: WitnessRow[]): Map<string, GroupedWitness> {
  const byCharacter = new Map<string, { witnessed: WitnessRow[]; told: WitnessRow[] }>()

  for (const row of rows) {
    if (!byCharacter.has(row.characterId)) {
      byCharacter.set(row.characterId, { witnessed: [], told: [] })
    }
    const entry = byCharacter.get(row.characterId)!
    if (row.grade === 'WITNESSED') entry.witnessed.push(row)
    else entry.told.push(row)
  }

  const result = new Map<string, GroupedWitness>()
  for (const [characterId, { witnessed, told }] of byCharacter) {
    const byRecency = (a: WitnessRow, b: WitnessRow) => b.turnNumber - a.turnNumber
    result.set(characterId, {
      witnessed: [...witnessed].sort(byRecency).slice(0, MAX_WITNESSED_EVENTS_IN_PROMPT).map((r) => r.reason),
      told: [...told].sort(byRecency).slice(0, MAX_TOLD_EVENTS_IN_PROMPT).map((r) => {
        const suffix = r.distorted && r.distortionFlavor ? DISTORTION_SUFFIXES[r.distortionFlavor] ?? '' : ''
        return `${r.reason}${suffix}`
      }),
    })
  }
  return result
}
