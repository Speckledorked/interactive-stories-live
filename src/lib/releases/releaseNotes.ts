// src/lib/releases/releaseNotes.ts
//
// What has changed, written for the people it changed things for.
//
// The only history this project had was the Fix Log in docs/ARCHITECTURE.md
// — 122 entries of "indexed the raw array while the caller retired into the
// normalized one". That is the right register for the people maintaining
// the engine and the wrong one for everybody else, so these are written
// fresh rather than generated from it. An entry earns its place by changing
// something a player would notice at the table; an entry nobody at the
// table would feel does not belong here however much work it took.
//
// Shaped like the tutorial content next door (lib/tutorial/content): a
// readonly array of plain objects with stable ids and `body: string[]`, so
// the same guard tests can walk it. That matters more than it looks —
// release notes are player-facing copy, and the rules that copy lives under
// are not relaxed because the page is called "updates". No published
// thresholds or rates, nothing that names deliberately hidden state, and
// the game master is MythOS rather than any description of the machinery.
// See lib/tutorial/content/__tests__/noPlayerFacingSpoilers.test.ts and
// __tests__/mythosVoice.test.ts, both of which cover this file.
//
// One entry is one change, tagged with the release it shipped in, rather
// than one entry per release holding a bundle. The homepage wants "the last
// few things that changed" regardless of how they were grouped, and on the
// day there is exactly one release that distinction is the difference
// between showing five things and showing one.

export interface ReleaseNote {
  /** Stable slug. Never reused, never renumbered — it may be linked to. */
  id: string
  /** The release this shipped in, e.g. '1.0'. */
  version: string
  /** ISO YYYY-MM-DD. Display only; ordering comes from array position. */
  date: string
  title: string
  body: string[]
}

/**
 * Newest first. Order here IS the order shown — deliberately not sorted by
 * date at render time, because two things that shipped the same day still
 * have a most-important one, and only a person can say which.
 */
export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    id: 'established-characters',
    version: '1.0',
    date: '2026-09-12',
    title: 'Start as someone who has already lived',
    body: [
      'Character creation used to put everyone at the very bottom, whatever you had in mind. If you wanted to play a veteran — someone with a reputation, a rank people recognise, and abilities they earned years before the story opens — you had to start as a nobody and grind the fiction until it agreed with the backstory you had already written.',
      'Now you can claim a standing your world actually recognises, and pick what your character already knows how to do. The world decides what those rungs are called, so a setting that speaks in ranks gives you ranks, and one that has never used the word simply lets you choose what you can already do.',
    ],
  },
  {
    id: 'earned-rank',
    version: '1.0',
    date: '2026-09-12',
    title: 'Rank is something the story gives you',
    body: [
      'Where a world has a ladder, standing on it is now a real part of play rather than a label on your sheet. MythOS moves you when the fiction earns it — when something happens that would actually change how people speak to you — and not for ordinary progress.',
      'It cannot invent a rung. If the ladder your world declared has no such step, nothing is recorded, and you are told why rather than quietly given a title nobody in that world would recognise.',
    ],
  },
  {
    id: 'consequences-that-end',
    version: '1.0',
    date: '2026-09-12',
    title: 'A threat you ended stays ended',
    body: [
      'Resolving something that had been hanging over your character did not always take. The contract was called off in the story, and then went on quietly shaping every scene afterwards as though it never had been. Worse, on a character carrying several, ending one could retire the wrong one.',
      'Both are fixed. What you resolve is what stops, and what you have not resolved keeps its teeth. Threats you have put behind you are also kept rather than deleted — something your character survived is part of who they are, not an absence.',
    ],
  },
  {
    id: 'legible-scenes',
    version: '1.0',
    date: '2026-09-12',
    title: 'Scenes say what they mean',
    body: [
      'Some openings and some entries in the behind-the-screen panel were rendering internal bookkeeping instead of the thing it described. If you ever read a line about a threat and found gibberish where the threat should have been, that was this.',
    ],
  },
  {
    id: 'a-front-door',
    version: '1.0',
    date: '2026-09-12',
    title: 'A front door',
    body: [
      'MythOS has a homepage now — something to send a friend that explains what this is before asking them to sign up, rather than handing them a password field and hoping.',
    ],
  },
]

/** The most recent `count` notes, for the homepage summary. */
export function latestReleaseNotes(count: number): readonly ReleaseNote[] {
  return RELEASE_NOTES.slice(0, Math.max(0, count))
}

/**
 * Notes grouped by release, newest release first, preserving the order
 * within each. Used by /updates; the homepage shows a flat list instead.
 */
export function releaseNotesByVersion(): { version: string; date: string; notes: ReleaseNote[] }[] {
  const groups: { version: string; date: string; notes: ReleaseNote[] }[] = []
  for (const note of RELEASE_NOTES) {
    const existing = groups.find((g) => g.version === note.version)
    if (existing) existing.notes.push(note)
    else groups.push({ version: note.version, date: note.date, notes: [note] })
  }
  return groups
}
