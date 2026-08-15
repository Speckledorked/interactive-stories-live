// src/lib/game/actionSuggestions.ts
//
// The "EXAMPLES" chips under the action box: three starting points a
// player can tap to fill the textarea instead of facing a blank field.
//
// Deliberately NOT an AI call. This runs on every render of the core
// loop's primary control, and a suggestion that arrives half a second
// late — or costs a token budget, or fails when the API is down — is
// worse than no suggestion. These are deterministic string templates
// over text the page already has.
//
// The three slots are fixed and cover the three things a player
// generally wants to do next: talk to someone, look into something, or
// hold back and watch. Only the first is context-derived; the other two
// are always available because they're always valid moves.
//
// On the speaker extraction specifically: this does NOT try to find
// names in prose generally — that reliably produces nonsense like "The
// Door said". It matches a small set of speech-attribution shapes where
// the grammar itself tells you the preceding or following capitalised
// word is an agent, requires the candidate to look like a name, and
// rejects a stoplist of sentence-openers that are capitalised for
// position rather than because they're names. If nothing matches
// confidently, the dialogue slot falls back to a generic prompt. A
// wrong name in a suggestion chip is much worse than a generic one:
// it invents a character the player then has to reconcile.

export interface ActionSuggestion {
  /** Short label for the chip. */
  label: string
  /** Text dropped into the action box when the chip is tapped. */
  text: string
  kind: 'dialogue' | 'investigate' | 'observe'
}

// Verbs that attribute speech. Kept narrow on purpose — "moved",
// "turned" and friends take subjects that are often not speakers.
const SPEECH_VERBS =
  'says?|said|asks?|asked|answers?|answered|replies|replied|whispers?|whispered|' +
  'shouts?|shouted|mutters?|muttered|calls?|called|warns?|warned|offers?|offered'

// A capitalised token that could plausibly be a name, optionally with a
// second capitalised word ("Captain Vale", "Mother Anselm").
const NAME = "[A-Z][a-z'’-]{1,20}(?: [A-Z][a-z'’-]{1,20})?"

const PATTERNS = [
  // "Vale said", "Captain Vale asks"
  new RegExp(`\\b(${NAME}) (?:${SPEECH_VERBS})\\b`),
  // "said Vale", "whispered Mother Anselm"
  new RegExp(`\\b(?:${SPEECH_VERBS}) (${NAME})\\b`),
]

// Words that start sentences and would otherwise pass the NAME shape.
// A false positive here becomes a chip naming a character who doesn't
// exist, so this leans towards rejecting.
const NOT_NAMES = new Set([
  'The', 'A', 'An', 'You', 'Your', 'She', 'He', 'They', 'It', 'We', 'I',
  'This', 'That', 'These', 'Those', 'There', 'Here', 'Then', 'When',
  'What', 'Who', 'Why', 'How', 'If', 'But', 'And', 'So', 'As', 'At',
  'One', 'Someone', 'Somebody', 'Everyone', 'Nobody', 'Something',
  'Before', 'After', 'Now', 'Still', 'Meanwhile', 'Finally', 'Instead',
  'His', 'Her', 'Their', 'Its', 'Our', 'My',
])

/**
 * Most recent named speaker in a passage, or null when nothing matches
 * confidently. Exported for testing — the extraction is the only part of
 * this module with a real chance of being wrong.
 */
export function extractSpeaker(resolutionText: string | null | undefined): string | null {
  if (!resolutionText) return null

  // Search the last paragraph first: the most recent speaker is the one
  // the player is most likely to still be facing.
  const paragraphs = resolutionText.split(/\n{2,}/).filter((p) => p.trim()).reverse()

  for (const paragraph of paragraphs) {
    for (const pattern of PATTERNS) {
      const match = paragraph.match(pattern)
      if (!match) continue
      const candidate = match[1].trim()
      const firstWord = candidate.split(' ')[0]
      if (NOT_NAMES.has(firstWord)) continue
      return candidate
    }
  }
  return null
}

export interface SuggestionInput {
  /** The scene's latest resolution prose, if it has resolved at all. */
  resolutionText?: string | null
  /** The scene's stated stakes, if generated. */
  stakes?: string | null
}

/**
 * Three tappable starting points for the action box. Always returns
 * exactly three, in a stable order, so the chip row never reflows
 * between renders.
 */
export function buildActionSuggestions(input: SuggestionInput = {}): ActionSuggestion[] {
  const speaker = extractSpeaker(input.resolutionText)

  const dialogue: ActionSuggestion = speaker
    ? {
        kind: 'dialogue',
        label: `Talk to ${speaker}`,
        text: `I turn to ${speaker} and press for a straight answer about what's really going on here.`,
      }
    : {
        kind: 'dialogue',
        label: 'Talk to someone',
        text: 'I look for whoever here seems most likely to talk, and open a conversation.',
      }

  // The stakes line, when there is one, is the sharpest thing to
  // investigate — it's the scene telling you what it's about.
  const stakes = input.stakes?.trim()
  const investigate: ActionSuggestion = stakes
    ? {
        kind: 'investigate',
        label: 'Look into it',
        text: `I take a closer look at what's at stake here — ${stripTrailingPeriod(stakes)} — and try to work out where it actually stands.`,
      }
    : {
        kind: 'investigate',
        label: 'Look into it',
        text: 'I search the area carefully, looking for anything out of place or worth taking with me.',
      }

  const observe: ActionSuggestion = {
    kind: 'observe',
    label: 'Hold back and watch',
    text: 'I hold back for a moment and watch, letting whatever is about to happen show itself before I commit.',
  }

  return [dialogue, investigate, observe]
}

// The stakes go in verbatim apart from a trailing period. An earlier
// version lowercased the first letter to read as mid-sentence, which
// silently mangled any stakes line opening on a proper noun ("Vale's
// debt" -> "vale's debt"). Nothing in the string's shape distinguishes a
// name from a sentence-opener, so the em-dashes do the work instead —
// a capitalised word inside them reads fine.
function stripTrailingPeriod(s: string): string {
  return s.replace(/[.!?]+$/, '')
}
