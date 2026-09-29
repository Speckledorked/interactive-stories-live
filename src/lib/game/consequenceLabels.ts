// src/lib/game/consequenceLabels.ts
//
// How each freeform consequence category is NAMED to players, in one place.
//
// #475: #292 renamed the freeform debt category to "Noted Debt" and added a
// disclaimer, because `Character.consequences.debts` is a string array with
// no link to the real, mechanically-live Debt model — an entry there can
// never be marked settled, and may describe an obligation that was paid off
// in fiction a month ago, or one that was never a tracked Debt at all.
//
// That rename went into ConsequenceBadge as a string literal. It was the
// right copy in the wrong shape: CharacterSnapshotModal renders the same
// array under its own bare "DEBTS" heading, so the fix reached one of the
// two surfaces and the character sheet went on presenting possibly-settled
// flavour text as live obligations — the exact confusion #292 set out to
// end.
//
// A label that must be identical in two renderers is not a component's
// business. It lives here, and both read it, so a third surface inherits
// the distinction instead of re-inventing a heading.

export type ConsequenceType = 'promise' | 'debt' | 'enemy' | 'longTermThreat'

export interface ConsequenceLabel {
  /** Singular, for a badge. */
  label: string
  /** Plural and uppercase, for a section heading. */
  heading: string
  /**
   * Shown wherever this category is listed. Present only where the data
   * would otherwise be read as something it is not — see the debt entry.
   */
  note?: string
}

export const CONSEQUENCE_LABELS: Record<ConsequenceType, ConsequenceLabel> = {
  promise: { label: 'Promise', heading: 'PROMISES' },
  debt: {
    label: 'Noted Debt',
    heading: 'NOTED DEBTS',
    note: 'Informal note — not linked to the tracked Debt economy above.',
  },
  enemy: { label: 'Enemy', heading: 'ENEMIES' },
  longTermThreat: { label: 'Threat', heading: 'THREATS' },
}
