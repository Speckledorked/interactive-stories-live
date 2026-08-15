import { describe, it, expect } from 'vitest'
import { buildActionSuggestions, extractSpeaker } from '../actionSuggestions'

describe('extractSpeaker', () => {
  it('finds a speaker in subject-verb order', () => {
    expect(extractSpeaker('Vale said the road north is closed.')).toBe('Vale')
  })

  it('finds a speaker in verb-subject order', () => {
    expect(extractSpeaker('"Not that way," whispered Anselm.')).toBe('Anselm')
  })

  it('picks up a two-word name with a title', () => {
    expect(extractSpeaker('Captain Vale asks what you intend to do about it.')).toBe('Captain Vale')
  })

  it('prefers the most recent paragraph', () => {
    const text = 'Vale said little at first.\n\nLater, Anselm warned you against going alone.'
    expect(extractSpeaker(text)).toBe('Anselm')
  })

  // The failure this guards is specific: a capitalised sentence-opener
  // sitting in front of a speech verb reads exactly like a name, and a
  // wrong name in a chip invents a character the player has to reconcile.
  it('rejects capitalised sentence-openers that are not names', () => {
    expect(extractSpeaker('The door said nothing, of course.')).toBeNull()
    expect(extractSpeaker('She said the road north is closed.')).toBeNull()
    expect(extractSpeaker('Someone called out from the dark.')).toBeNull()
  })

  it('returns null when nothing attributes speech', () => {
    expect(extractSpeaker('Rain hammers the roof. The lantern gutters.')).toBeNull()
  })

  it('handles absent or empty text', () => {
    expect(extractSpeaker(null)).toBeNull()
    expect(extractSpeaker(undefined)).toBeNull()
    expect(extractSpeaker('')).toBeNull()
  })
})

describe('buildActionSuggestions', () => {
  it('always returns exactly three in a stable order', () => {
    const bare = buildActionSuggestions()
    expect(bare.map((s) => s.kind)).toEqual(['dialogue', 'investigate', 'observe'])

    const full = buildActionSuggestions({ resolutionText: 'Vale said no.', stakes: 'The bridge holds or it falls.' })
    expect(full.map((s) => s.kind)).toEqual(['dialogue', 'investigate', 'observe'])
  })

  it('names the speaker in the dialogue chip when one was found', () => {
    const [dialogue] = buildActionSuggestions({ resolutionText: 'Vale said the road north is closed.' })
    expect(dialogue.label).toBe('Talk to Vale')
    expect(dialogue.text).toContain('Vale')
  })

  it('falls back to a generic dialogue chip with no confident speaker', () => {
    const [dialogue] = buildActionSuggestions({ resolutionText: 'The door said nothing.' })
    expect(dialogue.label).toBe('Talk to someone')
  })

  it('folds the stakes into the investigate chip verbatim', () => {
    const [, investigate] = buildActionSuggestions({ stakes: 'The bridge holds or it falls.' })
    expect(investigate.text).toContain('The bridge holds or it falls')
    // The stakes' own trailing period shouldn't survive mid-sentence.
    expect(investigate.text).not.toContain('falls. —')
  })

  // Guards the bug an earlier version had: lowercasing the stakes' first
  // letter to read as mid-sentence mangled any line opening on a name.
  it('does not lowercase a stakes line that opens on a proper noun', () => {
    const [, investigate] = buildActionSuggestions({ stakes: "Vale's debt comes due" })
    expect(investigate.text).toContain("Vale's debt comes due")
  })

  it('uses a generic investigate chip when there are no stakes', () => {
    const [, investigate] = buildActionSuggestions({})
    expect(investigate.text).toContain('search the area')
  })
})
