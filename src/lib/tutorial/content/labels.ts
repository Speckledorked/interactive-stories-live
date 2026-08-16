// src/lib/tutorial/content/labels.ts
//
// Teaching copy has to name things, and in MythOS almost nothing has a
// fixed name.
//
// Campaign.statLabels renames the five stat keys per campaign, and
// lib/ai/moveFlavor.ts renames the moves the same way. Two campaigns show
// different words for the same underlying thing, and the player only ever
// sees their own campaign's words. A help page that said "roll +sharp"
// would be describing a vocabulary that appears nowhere on that player's
// screen.
//
// So there are two audiences and they need different sentences:
//
//   /help with no campaign in context  -> structural phrasing, no names
//   /help while playing a campaign     -> that campaign's own names
//
// The rule that keeps this honest: the fallback is the DEFAULT, and the
// copy is authored to read naturally without any substitution at all.
// Nothing here builds a sentence with a hole in it and hopes the hole
// gets filled — a missing campaign produces a complete, correct sentence,
// and a present campaign produces a more specific one.

/**
 * Whatever campaign context the caller happens to have. Every field is
 * optional because every caller has a different amount of it, and a page
 * with none must still render.
 */
export interface LabelContext {
  /** Campaign.statLabels, shape `{ cool: { label: 'Poise' }, ... }`. */
  statLabels?: unknown
}

export interface ResolvedLabels {
  /**
   * What to call the character's traits in running prose.
   * Fallback: "your traits".
   */
  traitsPhrase: string
  /**
   * This campaign's trait names, in display order, or [] when unknown.
   * Callers render a list only when this is non-empty.
   */
  traitNames: string[]
  /** True when a campaign's own vocabulary was available. */
  isCampaignSpecific: boolean
}

/**
 * The fixed stat keys. Deliberately NOT exported and never displayed —
 * they exist here only to read a campaign's renaming of them in a stable
 * order. Showing these words to a player would be showing them the engine.
 */
const STAT_KEYS = ['cool', 'hard', 'hot', 'sharp', 'weird'] as const

/**
 * Pull the display labels out of a Campaign.statLabels JSON blob.
 *
 * Defensive because this is a `Json?` column: it can be null, it can
 * predate the current shape, and a campaign generated when the AI call
 * failed has none at all. Anything unrecognized yields [] and the caller
 * falls back — a help page must never throw because a JSON blob is odd.
 */
export function readStatLabels(statLabels: unknown): string[] {
  if (!statLabels || typeof statLabels !== 'object' || Array.isArray(statLabels)) return []

  const blob = statLabels as Record<string, unknown>
  const names: string[] = []

  for (const key of STAT_KEYS) {
    const entry = blob[key]
    let label: unknown
    if (typeof entry === 'string') label = entry
    else if (entry && typeof entry === 'object') label = (entry as Record<string, unknown>).label

    if (typeof label === 'string' && label.trim()) names.push(label.trim())
  }

  // All or nothing. A partially-renamed set would mix a campaign's own
  // words with engine keys in the same sentence, which is worse than the
  // clean generic fallback.
  return names.length === STAT_KEYS.length ? names : []
}

export function resolveLabels(context?: LabelContext): ResolvedLabels {
  const traitNames = readStatLabels(context?.statLabels)

  if (traitNames.length === 0) {
    return {
      traitsPhrase: 'your traits',
      traitNames: [],
      isCampaignSpecific: false,
    }
  }

  return {
    traitsPhrase: 'your traits',
    traitNames,
    isCampaignSpecific: true,
  }
}

/**
 * "Poise, Grit, Charm, Wits and Insight" — an English list, for prose.
 * Returns '' for an empty list so callers can test it directly.
 */
export function formatNameList(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
