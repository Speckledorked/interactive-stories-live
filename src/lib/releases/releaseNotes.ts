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
    id: 'worlds-you-can-hand-to-someone-else',
    version: '1.2',
    date: '2026-10-01',
    title: 'Worlds you can hand to someone else',
    body: [
      'Until now every world started from nothing, alone. The only settings on offer were the handful that shipped with MythOS, and anything you built was yours and nobody else\'s — there was no way to let a friend, or a stranger, start from it.',
      'You can now publish a world you have made. It appears in a public list anyone can browse without an account, and anyone who likes the look of it can take their own copy in a single step: the same powers, the same factions, the same calendar, the same situation at the opening. Their copy is theirs. Nothing they do in it reaches your game, and nothing you do afterwards reaches theirs.',
      'What gets shared is the setting, never your table. Your scenes, your characters, what anyone said, what anyone rolled, your private notes: none of it is published, and none of it is in the copy somebody else takes. If you want people to read your actual story, that is what the chronicle link has always been for — and a chronicle now offers its readers a way into the world it describes, instead of ending on a full stop.',
      'Publishing is yours to undo. Taking a world back off the list leaves it working for anyone who already has the link or has already started from it, and you can put it back any time.',
    ],
  },
  {
    id: 'building-a-world-says-what-it-is-doing',
    version: '1.2',
    date: '2026-10-01',
    title: 'Making a world tells you what it is doing',
    body: [
      'Starting a campaign used to sit on "Building your world…" for a long, silent minute while a great deal happened that you could not see. If your connection dropped, or you closed the tab, or it simply took too long, the whole thing was lost and you began again from the form.',
      'It now works in the background and says which part it is on — drawing the map and deciding who holds it, settling the calendar and the customs, putting everyone where they belong. If it takes longer than it should, it carries on without you and the world turns up in your campaigns when it is ready rather than vanishing.',
      'Starting from a world somebody else published skips all of this. That work was already done once, by them, so your copy arrives more or less immediately.',
    ],
  },
  {
    id: 'invite-the-people-you-already-know',
    version: '1.2',
    date: '2026-10-01',
    title: 'Invite the people you already know',
    body: [
      'MythOS knew who your friends were and could do nothing with it. Inviting someone to a campaign meant making a link and then finding somewhere else — a chat, a message, an email — to send it to them.',
      'You can now invite a friend from inside the campaign, and they get the invitation here. It is addressed to them and only works for them, which is why it is safe to deliver this way where a copyable link would not be.',
      'Inviting the same person twice sends the nudge again rather than leaving two live invitations lying around, and someone you have barred from a campaign stays barred — an invitation is not a way back in.',
    ],
  },
  {
    id: 'a-letter-when-you-have-been-away',
    version: '1.2',
    date: '2026-10-01',
    title: 'A letter when you have been away a while',
    body: [
      'Your worlds have always kept turning while you were gone, and MythOS has always been able to tell you what happened when you came back. It just never went and told you there was anything to come back to.',
      'If you have been away from a campaign for a good while and something real has happened in it, you will get one letter saying what. Not a reminder that the app exists — the actual events, the same ones the lobby would show you on your return, and only the ones your character could have heard about.',
      'It will not write to you if nothing happened, it will not write often, and it stops writing if you do not come back. You can turn it off entirely under notification settings, and you can do that before ever receiving one.',
    ],
  },
  {
    id: 'a-world-that-argues-with-itself',
    version: '1.1',
    date: '2026-09-29',
    title: 'The world argues with itself now',
    body: [
      'A faction used to decide what to do next by looking mostly at itself — what it wanted, what it could afford. It now looks at the state of the world it lives in, and the world pushes back.',
      'Weather, ruin, hunger, a road someone cut, a rumour that reached the wrong ears, a debt that came due at a bad moment: all of it reaches the people who make decisions. The practical difference is that consequences travel. Something you did in one corner of the map shows up later in a choice someone makes on the other side of it, and it will not always be obvious that the two were connected.',
    ],
  },
  {
    id: 'war-costs-something',
    version: '1.1',
    date: '2026-09-29',
    title: 'A war costs something to fight',
    body: [
      'Armies used to grind against each other in a vacuum. Now the ground and the season take their share: fighting through winter wears both sides down, a battlefield already wrecked wears them down faster, and an attacker whose supply line does not actually reach the front pays for that every turn it continues.',
      'None of this is announced. You will read about a campaign stalling, or a siege that should have held collapsing early, and the reason will be somewhere in the state of the world rather than in a number anyone showed you.',
    ],
  },
  {
    id: 'nobody-starts-a-war-lightly',
    version: '1.1',
    date: '2026-09-29',
    title: 'Nobody starts a war lightly',
    body: [
      'Declarations are much harder to come by, because the people making them now have reasons not to. A faction already frightened of something else will not open a second front. One whose own footing is unsteady will not gamble on it. One that has defaulted on what it owes cannot find anyone to fund it. And a leader with a great deal to lose personally will refuse, whatever the faction wants.',
      'Allies joining a war are weighed the same way rather than piling in because they were nearby.',
    ],
  },
  {
    id: 'debts-between-powers',
    version: '1.1',
    date: '2026-09-29',
    title: 'Debts between powers come due',
    body: [
      'A faction with money now quietly pays down its oldest obligations, and one that cannot pay defaults — which costs it standing, and sours things with whoever it owed.',
      'That souring is real and it lasts. A creditor who was merely irritated with you last season can be an enemy by the next, and nothing had to happen on a battlefield for it.',
    ],
  },
  {
    id: 'ruin-and-flight-leave-a-mark',
    version: '1.1',
    date: '2026-09-29',
    title: 'Ruin and flight leave a mark',
    body: [
      'A place people have abandoned produces nothing for whoever holds it, and a place that has been wrecked produces less than it did. Holding ground is no longer the same thing as benefiting from it.',
      'People fleeing somewhere now think about where they are going. They avoid land held by people they have reason to fear, and they will walk past a perfectly good destination to do it.',
    ],
  },
  {
    id: 'whispers-are-private',
    version: '1.1',
    date: '2026-09-29',
    title: 'Whispers are private again',
    body: [
      'Live updates — whispers, notifications, everything happening in a campaign as it happens — travelled on channels that were not properly closed. In practice you needed to know a campaign or account identifier to listen in, and those are not secret: a campaign identifier sits in the address bar and gets passed around with every invite link.',
      'Those channels are now closed properly, and the server checks you belong to a campaign before it will send you anything from it. Your whispers go to the person you whispered to.',
      'This changed how your browser connects, so a tab left open across the update needs one refresh before live updates resume. Nothing was lost — anything sent while a tab was stale is still there when it reloads.',
    ],
  },
  {
    id: 'the-story-keeps-its-voice',
    version: '1.1',
    date: '2026-09-29',
    title: 'The story keeps its voice on a bad day',
    body: [
      'When the service that reads your actions had an outage, MythOS used to fall back to its plainest interpretation of what you wrote. Nothing broke, but scenes came out flatter, and there was no way for you to tell that was why.',
      'There is now a second route it can take when the first is unavailable, so a provider having a bad afternoon no longer quietly costs you the quality of an evening.',
      'It is also more patient than it was. When a provider asks it to slow down, MythOS waits and tries again instead of shrugging and writing something plain.',
    ],
  },
  {
    id: 'sessions-stay-yours',
    version: '1.1',
    date: '2026-09-29',
    title: 'Your session stays yours',
    body: [
      'Sign-in used to be held somewhere any script running on the page could read. It now lives somewhere scripts cannot reach at all, and it renews itself quietly in the background so that a long evening of play never drops you back at the login screen mid-scene.',
    ],
  },
  {
    id: 'the-story-tab-goes-somewhere',
    version: '1.1',
    date: '2026-09-29',
    title: 'The Story tab goes somewhere',
    body: [
      'If you opened Story on a phone before making a character, you got a page you could read and a scene you could start but never act in, with nothing on screen explaining why. It was the shortest path into the app and it dead-ended.',
      'It now tells you what is missing and offers to take you to character creation. Reading along without a character is still fine — that was always allowed, it just was not said.',
    ],
  },
  {
    id: 'the-name-of-your-campaign',
    version: '1.1',
    date: '2026-09-29',
    title: 'Your campaign has its name back',
    body: [
      'The header on the story, character and quest pages had been showing a generic word instead of what you called your world. It reads your title again.',
    ],
  },
  {
    id: 'terms-and-privacy',
    version: '1.1',
    date: '2026-09-29',
    title: 'Terms and privacy, in plain words',
    body: [
      'The signup form linked to a terms page and a privacy policy that did not exist. Both are written now, and written against what MythOS actually does rather than from a template: what is stored, who else sees it, how long it is kept, and what happens to your worlds if you leave.',
      'MythOS is in beta and the privacy policy says so, along with the parts that are genuinely uncomfortable — your story text reaches the providers that help generate it, because that is how the thing works.',
    ],
  },
  {
    id: 'nothing-starts-what-it-cannot-finish',
    version: '1.1',
    date: '2026-09-29',
    title: 'Nothing starts work it cannot pay for',
    body: [
      'A scene could begin, and exchanges inside it could run, on an account with nothing left in it — and you would only find out at the end, having already played the scene.',
      'Both now check first. If there is not enough to cover the work, you are told before anything is written rather than after, and told who in the group needs to top up.',
    ],
  },
  {
    id: 'the-recap-waits-for-you',
    version: '1.1',
    date: '2026-09-29',
    title: 'The recap waits until you have read it',
    body: [
      'Your "while you were away" summary marked itself as seen the moment it was generated. If the page failed to load, or you closed the tab before it rendered, that absence was spent — you would never be shown what you missed.',
      'It now waits for the page to actually put it in front of you. If something goes wrong on the way, the same summary is still waiting next time.',
    ],
  },
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
