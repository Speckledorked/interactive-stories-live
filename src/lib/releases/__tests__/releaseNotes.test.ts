// src/lib/releases/__tests__/releaseNotes.test.ts
//
// The registry rules for release notes, mirroring the tutorial content's
// own registry test next door.
//
// Ids are the part that actually matters: they are stable handles that can
// be linked to, so a duplicate silently shadows an entry in a keyed render
// and a renamed one breaks an inbound link. The rest pins the shape the
// page renders against, so a malformed entry fails here rather than as an
// empty gap on the homepage.
//
// What this file does NOT check is the prose, which is covered where the
// rest of the player-facing copy is covered — see
// lib/tutorial/content/__tests__/noPlayerFacingSpoilers.test.ts (which
// walks RELEASE_NOTES) and __tests__/mythosVoice.test.ts (whose globs
// include this directory).

import { describe, it, expect } from 'vitest'
import { RELEASE_NOTES, latestReleaseNotes, releaseNotesByVersion } from '../releaseNotes'

describe('release notes registry', () => {
  it('has entries at all', () => {
    // A page rendering an empty list looks the same as a page whose import
    // silently broke.
    expect(RELEASE_NOTES.length).toBeGreaterThan(0)
  })

  it('has unique ids', () => {
    const ids = RELEASE_NOTES.map((n) => n.id)
    expect(ids).toEqual([...new Set(ids)])
  })

  it('gives every entry a title and a non-empty body', () => {
    for (const note of RELEASE_NOTES) {
      expect(note.title.trim(), `release "${note.id}" title`).not.toBe('')
      expect(note.body.length, `release "${note.id}" body`).toBeGreaterThan(0)
      for (const paragraph of note.body) {
        expect(paragraph.trim(), `release "${note.id}" paragraph`).not.toBe('')
      }
    }
  })

  it('dates every entry in a form the page can parse', () => {
    // /updates formats these for display; an unparseable one would render
    // as the raw string rather than throwing, which is the kind of thing
    // nobody notices until it is on the homepage.
    for (const note of RELEASE_NOTES) {
      expect(note.date, `release "${note.id}"`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(new Date(`${note.date}T00:00:00Z`).getTime())).toBe(false)
    }
  })
})

describe('latestReleaseNotes', () => {
  it('takes from the front, which is the newest end', () => {
    expect(latestReleaseNotes(2)).toEqual(RELEASE_NOTES.slice(0, 2))
  })

  it('asks for more than exist without breaking', () => {
    expect(latestReleaseNotes(999)).toHaveLength(RELEASE_NOTES.length)
  })

  it('handles zero and negative counts', () => {
    expect(latestReleaseNotes(0)).toEqual([])
    expect(latestReleaseNotes(-1)).toEqual([])
  })
})

describe('releaseNotesByVersion', () => {
  it('groups without losing or duplicating an entry', () => {
    const grouped = releaseNotesByVersion().flatMap((g) => g.notes)
    expect(grouped).toEqual([...RELEASE_NOTES])
  })

  it('emits each version once, in first-seen order', () => {
    const versions = releaseNotesByVersion().map((g) => g.version)
    expect(versions).toEqual([...new Set(versions)])
  })
})
