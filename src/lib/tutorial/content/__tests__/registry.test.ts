// src/lib/tutorial/content/__tests__/registry.test.ts
//
// Structural integrity of the teaching content.
//
// The bug class this exists for: the old tutorial declared five CSS
// selectors to highlight and four of them matched no element in the DOM,
// and declared thirteen completion triggers of which exactly one was ever
// emitted. Nothing failed. Content that points at something which does
// not exist is the default failure mode of a teaching system, because
// nothing type-checks a reference from copy to the thing it describes.
//
// Every cross-reference in this registry is an id, and every one of them
// is checked here.

import { describe, it, expect } from 'vitest'
import { MECHANICS, CATEGORY_LABELS, CATEGORY_ORDER, getMechanic, searchMechanics } from '../mechanics'
import { ORIENTATION_CARDS } from '../orientation'
import { WALKTHROUGH } from '../walkthrough'
import { formatNameList, readStatLabels, resolveLabels } from '../labels'

const IDS = new Set(MECHANICS.map(m => m.id))

describe('every mechanic is complete', () => {
  it('has a unique id', () => {
    const ids = MECHANICS.map(m => m.id)
    expect(ids.length).toBe(new Set(ids).size)
  })

  it('has a term, a one-line summary, and real body prose', () => {
    for (const m of MECHANICS) {
      expect(m.term.trim(), `${m.id} has no term`).toBeTruthy()
      expect(m.short.trim(), `${m.id} has no short`).toBeTruthy()
      expect(m.body.length, `${m.id} has no body`).toBeGreaterThan(0)
      for (const paragraph of m.body) {
        expect(paragraph.trim(), `${m.id} has an empty body paragraph`).toBeTruthy()
      }
    }
  })

  // Aliases are the entire reason search works — a mechanic with none is
  // findable only by guessing the name we happened to give it.
  it('has at least one searchable alias', () => {
    for (const m of MECHANICS) {
      expect(m.aliases.length, `${m.id} has no aliases`).toBeGreaterThan(0)
      for (const alias of m.aliases) {
        expect(alias.trim(), `${m.id} has an empty alias`).toBeTruthy()
      }
    }
  })

  it('uses a category that the index actually renders', () => {
    for (const m of MECHANICS) {
      expect(CATEGORY_ORDER, `${m.id} has category ${m.category}`).toContain(m.category)
      expect(CATEGORY_LABELS[m.category]).toBeTruthy()
    }
  })

  // A category in the order list with nothing in it renders an empty
  // heading; the index guards against that at runtime, but an empty
  // category is a content mistake worth catching here.
  it('has no category listed in the index with nothing in it', () => {
    for (const category of CATEGORY_ORDER) {
      const count = MECHANICS.filter(m => m.category === category).length
      expect(count, `category "${category}" is empty`).toBeGreaterThan(0)
    }
  })
})

describe('every cross-reference resolves', () => {
  it('seeAlso points only at mechanics that exist', () => {
    const broken: string[] = []
    for (const m of MECHANICS) {
      for (const id of m.seeAlso ?? []) {
        if (!IDS.has(id)) broken.push(`${m.id} -> ${id}`)
        if (id === m.id) broken.push(`${m.id} -> itself`)
      }
    }
    expect(broken).toEqual([])
  })

  it('the orientation only links to mechanics that exist', () => {
    const broken = ORIENTATION_CARDS
      .filter(c => c.learnMore && !IDS.has(c.learnMore))
      .map(c => `${c.id} -> ${c.learnMore}`)
    expect(broken).toEqual([])
  })

  // This is the direct analogue of the four-dead-selectors bug: the
  // walkthrough names mechanics by id, and a rename would otherwise
  // silently render a section with nothing under it.
  it('the walkthrough only names mechanics that exist', () => {
    const broken: string[] = []
    for (const section of WALKTHROUGH) {
      expect(section.mechanicIds.length, `${section.id} is empty`).toBeGreaterThan(0)
      for (const id of section.mechanicIds) {
        if (!IDS.has(id)) broken.push(`${section.id} -> ${id}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('the walkthrough does not teach the same thing twice', () => {
    const all = WALKTHROUGH.flatMap(s => s.mechanicIds)
    expect(all.length).toBe(new Set(all).size)
  })
})

// Caught three separate times by hand while writing this content, which
// is the definition of something that should be a rule instead. A
// heading with the same words as one of the entries beneath it reads as a
// duplicate rather than as a grouping, and it makes every test that looks
// content up by its visible text ambiguous.
describe('no heading collides with the name of an entry under it', () => {
  const TERMS = new Set(MECHANICS.map(m => m.term.toLowerCase()))

  it('no category label is also a mechanic name', () => {
    const clashes = CATEGORY_ORDER
      .map(c => CATEGORY_LABELS[c])
      .filter(label => TERMS.has(label.toLowerCase()))
    expect(clashes).toEqual([])
  })

  it('no walkthrough section title is also a mechanic name', () => {
    const clashes = WALKTHROUGH
      .map(s => s.title)
      .filter(title => TERMS.has(title.toLowerCase()))
    expect(clashes).toEqual([])
  })

  it('no orientation card title is also a mechanic name', () => {
    const clashes = ORIENTATION_CARDS
      .map(c => c.title)
      .filter(title => TERMS.has(title.toLowerCase()))
    expect(clashes).toEqual([])
  })
})

describe('the orientation stays short', () => {
  // Not an arbitrary number. The orientation exists to answer "what is
  // this and how do I act"; the moment it grows into a syllabus it
  // teaches a newcomer that this game is complicated, which is the exact
  // failure the previous fourteen-step tutorial shipped with. If a card
  // genuinely needs adding, something should come out.
  it('is a handful of cards, not a manual', () => {
    expect(ORIENTATION_CARDS.length).toBeLessThanOrEqual(6)
  })

  it('gives every card a title and body', () => {
    for (const c of ORIENTATION_CARDS) {
      expect(c.title.trim(), `${c.id} has no title`).toBeTruthy()
      expect(c.body.length, `${c.id} has no body`).toBeGreaterThan(0)
    }
  })

  it('has unique card ids', () => {
    const ids = ORIENTATION_CARDS.map(c => c.id)
    expect(ids.length).toBe(new Set(ids).size)
  })
})

describe('search finds things by what is on screen', () => {
  it('finds a mechanic by an alias a player would read, not by its id', () => {
    // "Heard secondhand" is the phrase on a rumor card; "rumors" is the
    // page name. Both must land on the same page.
    expect(searchMechanics('heard secondhand')[0]?.id).toBe('rumors')
    expect(searchMechanics('x-card')[0]?.id).toBe('safety')
    expect(searchMechanics('fog of war')[0]?.id).toBe('what-you-know')
  })

  it('ranks an exact term or alias above a passing mention in body text', () => {
    const results = searchMechanics('threads')
    expect(results[0]?.id).toBe('threads')
  })

  it('returns everything for an empty query and nothing for nonsense', () => {
    expect(searchMechanics('').length).toBe(MECHANICS.length)
    expect(searchMechanics('   ').length).toBe(MECHANICS.length)
    expect(searchMechanics('zzzzznotathing')).toEqual([])
  })

  it('is case-insensitive', () => {
    expect(searchMechanics('X-CARD')[0]?.id).toBe('safety')
  })
})

describe('getMechanic', () => {
  it('returns the mechanic for a known id', () => {
    expect(getMechanic('scenes')?.term).toBe('Scenes')
  })

  it('returns undefined for an unknown id, so the route can 404', () => {
    expect(getMechanic('not-a-mechanic')).toBeUndefined()
  })
})

describe('label resolution degrades to complete sentences', () => {
  it('falls back to structural phrasing with no campaign at all', () => {
    const labels = resolveLabels()
    expect(labels.isCampaignSpecific).toBe(false)
    expect(labels.traitsPhrase).toBe('your traits')
    expect(labels.traitNames).toEqual([])
  })

  it('reads a campaign\'s own names out of the statLabels blob', () => {
    const names = readStatLabels({
      cool: { label: 'Poise' },
      hard: { label: 'Grit' },
      hot: { label: 'Charm' },
      sharp: { label: 'Wits' },
      weird: { label: 'Insight' },
    })
    expect(names).toEqual(['Poise', 'Grit', 'Charm', 'Wits', 'Insight'])
  })

  it('accepts the bare-string shape as well as the object shape', () => {
    const names = readStatLabels({
      cool: 'Poise', hard: 'Grit', hot: 'Charm', sharp: 'Wits', weird: 'Insight',
    })
    expect(names).toEqual(['Poise', 'Grit', 'Charm', 'Wits', 'Insight'])
  })

  // All-or-nothing: a partial rename would mix a campaign's own words
  // with engine keys in one sentence, which is worse than the clean
  // generic fallback.
  it('falls back rather than half-renaming when the blob is incomplete', () => {
    expect(readStatLabels({ cool: { label: 'Poise' } })).toEqual([])
  })

  it('never throws on a malformed or absent blob', () => {
    // Campaign.statLabels is a nullable Json column, so all of these are
    // reachable in production. A help page must not crash on any of them.
    for (const input of [null, undefined, 'nonsense', 42, [], {}, { cool: 5 }]) {
      expect(() => readStatLabels(input)).not.toThrow()
      expect(readStatLabels(input)).toEqual([])
    }
  })

  it('formats a name list as English prose', () => {
    expect(formatNameList([])).toBe('')
    expect(formatNameList(['Poise'])).toBe('Poise')
    expect(formatNameList(['Poise', 'Grit'])).toBe('Poise and Grit')
    expect(formatNameList(['Poise', 'Grit', 'Charm'])).toBe('Poise, Grit and Charm')
  })
})
