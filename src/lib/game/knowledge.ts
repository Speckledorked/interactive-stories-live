// src/lib/game/knowledge.ts
// Structured, permanent character knowledge (#173/#174).
//
// Before this, "does my character know X?" had no canonical answer —
// only RAG similarity search over CampaignMemory/LoreEntry, both
// campaign-scoped and retrieval-based, not tied to what a SPECIFIC
// character has actually confirmed learning. RAG is genuinely right for
// "when/how did they learn this?" (supporting context); it was standing
// in for "do they currently know this?" (a yes/no fact), which needs a
// real answer, not a similarity score.
//
// Deliberately NOT the capability tree (lib/game/capabilities.ts):
// capabilities are about a SYSTEM's existence and this character's
// proficiency in using it (glimpse -> unlock -> progress). This is
// unrelated declarative fact-knowledge — "the baron is corrupt," "the
// vault is beneath the chapel" — that never had a proficiency dimension
// to begin with.

export interface KnownConcept {
  key: string
  label: string
  learnedAt: number // turn number
  source?: string
}

export interface KnowledgeState {
  concepts: KnownConcept[]
}

// Generous relative to Scene.progressState's per-scene bounds — this is
// meant to persist for the character's whole campaign, not one scene.
// Still bounded: dedup by key already prevents runaway growth from the
// same fact being re-reported, this is a backstop against genuinely
// distinct facts accumulating without limit over dozens of sessions.
export const MAX_KNOWN_CONCEPTS = 60

export function createDefaultKnowledgeState(): KnowledgeState {
  return { concepts: [] }
}

/**
 * Read `Character.knownConcepts` leniently. Never throws on null/
 * malformed/legacy data — mirrors parseHarmState's degrade-field-by-field
 * philosophy, at the level this shape actually needs (one array).
 */
export function parseKnowledgeState(value: unknown): KnowledgeState {
  const state = createDefaultKnowledgeState()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return state

  const raw = value as Record<string, unknown>
  if (Array.isArray(raw.concepts)) {
    state.concepts = raw.concepts.filter(
      (c): c is KnownConcept =>
        !!c && typeof c === 'object' &&
        typeof (c as any).key === 'string' &&
        typeof (c as any).label === 'string'
    )
  }
  return state
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase()
}

/**
 * Add (or refresh) a known concept, deduped by key. A concept re-reported
 * under the same key updates its label/source rather than duplicating —
 * the fiction's phrasing of a fact can sharpen over time ("something's off
 * about the baron" -> "the baron is secretly a vampire") without the
 * sheet accumulating both as separate entries. Pure — the caller persists
 * the result.
 */
export function addKnownConcept(
  existing: KnownConcept[],
  concept: { key: string; label: string; source?: string },
  currentTurn: number
): KnownConcept[] {
  const key = normalizeKey(concept.key)
  if (!key) return existing

  const entry: KnownConcept = {
    key,
    label: concept.label,
    source: concept.source,
    learnedAt: currentTurn
  }

  const existingIndex = existing.findIndex(c => normalizeKey(c.key) === key)
  if (existingIndex >= 0) {
    // Refresh in place, but keep the ORIGINAL learnedAt — re-confirming a
    // fact doesn't change when the character first learned it.
    const updated = [...existing]
    updated[existingIndex] = { ...entry, learnedAt: existing[existingIndex].learnedAt }
    return updated
  }

  return [...existing, entry].slice(-MAX_KNOWN_CONCEPTS)
}

/**
 * Remove a known concept by key — rare (a corrected misconception).
 * Pure — the caller persists the result.
 */
export function removeKnownConcept(existing: KnownConcept[], key: string): KnownConcept[] {
  const target = normalizeKey(key)
  return existing.filter(c => normalizeKey(c.key) !== target)
}
