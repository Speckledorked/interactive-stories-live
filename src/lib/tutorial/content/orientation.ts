// src/lib/tutorial/content/orientation.ts
//
// The thing that appears the first time you open MythOS.
//
// Nothing in the product currently answers "what is this?" for someone who
// has just arrived. That is the single largest gap: a person who finds the
// platform is dropped straight into a campaign list with no idea what kind
// of thing they are looking at.
//
// DELIBERATELY SHORT. The temptation is to explain everything here, and
// that is exactly the failure mode — a newcomer handed a complete systems
// reference learns that this game is complicated, which is the opposite of
// what we want them to learn. Orientation answers "what is this and how do
// I act", and stops. Everything else is taught at first encounter, or when
// someone goes looking in /help.
//
// The bar for a card being in this list: a player who does not know this
// will either be confused by the very first thing they see, or will be
// unpleasantly surprised later. Money is in here for the second reason —
// nobody should discover that scenes cost money by being charged.

export interface OrientationCard {
  /** Stable id, used as a React key and in tests. */
  id: string
  title: string
  /** One or two short paragraphs. Plain prose. */
  body: string[]
  /** Optional mechanic id in the registry, for "read more". */
  learnMore?: string
}

export const ORIENTATION_CARDS: readonly OrientationCard[] = [
  {
    id: 'what-is-this',
    title: 'What this is',
    body: [
      'MythOS runs a story you play through with other people. You describe what your character does, in your own words, and the story continues from there.',
      'An AI narrates it — but it does not decide whether you succeed. That is settled before a word of the story is written.',
    ],
    learnMore: 'actions',
  },
  {
    id: 'the-world-moves',
    title: 'The world keeps moving',
    body: [
      'This is not a story that waits for you. Factions pursue their plans, people travel and fall out and die, and situations you left alone keep developing while you are gone.',
      'Come back after a week and you will find what happened, not a pause button.',
    ],
    learnMore: 'world-turn',
  },
  {
    id: 'what-you-know',
    title: 'You do not see everything',
    body: [
      'You see what your character could plausibly know. Places you have not found and plans nobody has told you about are simply not there.',
      'What you witnessed yourself is solid. What reached you secondhand is marked as such — and it may be wrong.',
    ],
    learnMore: 'what-you-know',
  },
  {
    id: 'scenes-cost',
    title: 'Scenes cost real money',
    body: [
      'MythOS writes with a paid AI model. You are charged the real cost of it when a scene ends, split across the players who took part.',
      'Your balance is on your account. Nothing starts work you cannot cover.',
    ],
    learnMore: 'scene-cost',
  },
  {
    id: 'safety',
    title: 'You can stop anything',
    body: [
      'The X-Card on the story page pauses or pulls back from anything you are not comfortable with. You never owe anyone a reason for using it.',
      'Your table can also rule things out before you start playing.',
    ],
    learnMore: 'safety',
  },
]
