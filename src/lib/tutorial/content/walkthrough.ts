// src/lib/tutorial/content/walkthrough.ts
//
// The /tutorial page's running order.
//
// DELIBERATELY INCOMPLETE, and that is the design. The old tutorial tried
// to be a syllabus — fourteen steps across "basics / social / combat /
// advanced" — and a newcomer handed a complete systems reference learns
// one thing above all others: that this game is complicated. That is the
// opposite of what a first session needs.
//
// So this covers exactly two questions — "how do I take my first action"
// and "what do I need to know before something surprises me" — and then
// points at /help for everything else. Corruption, factions, downtime,
// wars and the rest are taught at first encounter, in place, or when
// somebody goes looking.
//
// Each entry is a mechanic id from ./mechanics.ts rather than its own
// copy, so the tutorial and the reference can never drift into saying
// different things about the same system.

export interface WalkthroughSection {
  id: string
  title: string
  /** Why this section is here, in one line, addressed to the player. */
  lede: string
  /** Mechanic ids from ./mechanics.ts, in teaching order. */
  mechanicIds: string[]
}

export const WALKTHROUGH: readonly WalkthroughSection[] = [
  {
    id: 'first-scene',
    title: 'Your first scene',
    lede: 'Enough to play. Everything here is something you will use in the first ten minutes.',
    mechanicIds: ['scenes', 'actions', 'ending-a-scene'],
  },
  {
    id: 'before-you-start',
    title: 'Two things to know first',
    lede: 'Neither of these should ever be a surprise, so they come before you play rather than after.',
    mechanicIds: ['scene-cost', 'safety'],
  },
  {
    id: 'your-character',
    title: 'Reading your character',
    lede: 'What is on your sheet, and what is deliberately not.',
    mechanicIds: ['character-sheet', 'harm'],
  },
  {
    id: 'the-world',
    title: 'The world you are in',
    lede: 'The part that makes this a place rather than a backdrop. Worth knowing early; you do not have to master it.',
    mechanicIds: ['world-turn', 'what-you-know'],
  },
]
