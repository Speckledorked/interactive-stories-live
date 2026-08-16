// src/lib/game/__tests__/absenceJournal.test.ts
// #396: the floor on what a returning player can reconstruct.

import { describe, it, expect } from 'vitest'
import {
  buildAbsenceJournal,
  compareJournalEvents,
  describeJournalEntry,
  categoryOf,
  CATEGORY_PRIORITY,
  MAX_JOURNAL_ENTRIES,
  type JournalEventInput,
} from '../absenceJournal'

let seq = 0
const event = (over: Partial<JournalEventInput> = {}): JournalEventInput => ({
  id: `e${(seq += 1)}`,
  turnNumber: 1,
  createdAt: new Date(2026, 0, 1),
  targetType: 'FACTION',
  targetId: 't1',
  targetName: 'The Rustwatch',
  field: 'resources',
  significant: false,
  importance: 'NORMAL',
  ...over,
})

describe('categoryOf', () => {
  it('maps every location target type to one player-facing category', () => {
    expect(categoryOf('LOCATION_WEATHER')).toBe('places')
    expect(categoryOf('LOCATION_CONDITION')).toBe('places')
    expect(categoryOf('LOCATION_POPULATION')).toBe('places')
  })

  it('returns null for a target type it does not know, rather than guessing', () => {
    expect(categoryOf('SOMETHING_NEW')).toBeNull()
  })
})

describe('compareJournalEvents — a total order (#396)', () => {
  it('never ties two distinct events', () => {
    // The defect this replaces: `orderBy turnNumber desc` with no tiebreak.
    // Over a frozen turn counter every row tied, so which five survived the
    // cap was whatever Postgres returned — the surface that was supposed to
    // summarise an absence picked arbitrarily, and differently each call.
    const a = event({ id: 'a' })
    const b = event({ id: 'b' })

    expect(compareJournalEvents(a, b)).not.toBe(0)
    expect(compareJournalEvents(a, b)).toBe(-compareJournalEvents(b, a))
  })

  it('ranks MAJOR above significant above merely recent', () => {
    const major = event({ id: 'major', importance: 'MAJOR', turnNumber: 1 })
    const significant = event({ id: 'sig', significant: true, turnNumber: 2 })
    const recent = event({ id: 'recent', turnNumber: 30 })

    const sorted = [recent, significant, major].sort(compareJournalEvents).map((e) => e.id)
    expect(sorted).toEqual(['major', 'sig', 'recent'])
  })
})

describe('buildAbsenceJournal — coverage before depth (#396)', () => {
  it('is empty for an empty window', () => {
    const journal = buildAbsenceJournal([])

    expect(journal.entries).toEqual([])
    expect(journal.categoriesPresent).toEqual([])
    expect(journal.turnRange).toBeNull()
  })

  it('reports every category that had an event, even when one category floods the window', () => {
    // The failure this exists for: weather is by far the loudest category by
    // row count, so a recency-first cap of 5 over thirty turns returned five
    // weather rows and nothing else. Everything about wars, quests, clocks
    // and the economy was unreconstructible from any player surface.
    const weather = Array.from({ length: 200 }, (_, i) =>
      event({ targetType: 'LOCATION_WEATHER', turnNumber: 30, field: 'weather', targetName: 'Kel Marsh' })
    )
    const war = event({ targetType: 'WAR', turnNumber: 2, field: 'warDeclared', targetName: 'The Rustwatch' })
    const quest = event({ targetType: 'QUEST', turnNumber: 3, field: 'status', targetName: 'The Ashen Debt' })
    const clock = event({ targetType: 'CLOCK', turnNumber: 4, field: 'currentTicks', targetName: 'The Siege' })

    const journal = buildAbsenceJournal([...weather, war, quest, clock])

    expect(journal.categoriesPresent.sort()).toEqual(['clocks', 'places', 'quests', 'wars'])
    const reported = new Set(journal.entries.map((e) => e.category))
    expect(reported).toEqual(new Set(['clocks', 'places', 'quests', 'wars']))
  })

  it('spends a budget too small for every category on the highest-priority ones', () => {
    const one = (targetType: string) => event({ targetType })
    const all = CATEGORY_PRIORITY.map((_, i) => one(['WAR', 'FACTION', 'QUEST', 'CLOCK', 'NPC', 'DEBT', 'LOCATION_WEATHER'][i]))

    const journal = buildAbsenceJournal(all, 3)

    expect(journal.entries).toHaveLength(3)
    // Wars, factions, quests — what changes what a player would do next.
    expect(new Set(journal.entries.map((e) => e.category))).toEqual(new Set(['wars', 'factions', 'quests']))
  })

  it('fills leftover budget with depth once every category is covered', () => {
    const wars = Array.from({ length: 10 }, () => event({ targetType: 'WAR', field: 'warDeclared' }))

    const journal = buildAbsenceJournal(wars, 4)

    expect(journal.entries).toHaveLength(4)
    expect(journal.totalEvents).toBe(10)
  })

  it('never returns more than the budget', () => {
    const many = Array.from({ length: 500 }, () => event({ targetType: 'NPC' }))

    expect(buildAbsenceJournal(many).entries.length).toBeLessThanOrEqual(MAX_JOURNAL_ENTRIES)
  })

  it('reads oldest-first, so a reconstruction reads as a story', () => {
    const early = event({ targetType: 'WAR', turnNumber: 2, importance: 'MAJOR' })
    const late = event({ targetType: 'WAR', turnNumber: 29, importance: 'MAJOR' })

    const journal = buildAbsenceJournal([late, early])

    expect(journal.entries.map((e) => e.turnNumber)).toEqual([2, 29])
    expect(journal.turnRange).toEqual({ from: 2, to: 29 })
  })

  it('drops target types it has no category for rather than rendering them uncategorised', () => {
    const journal = buildAbsenceJournal([event({ targetType: 'SOMETHING_NEW' })])

    expect(journal.entries).toEqual([])
    expect(journal.totalEvents).toBe(0)
  })
})

describe('describeJournalEntry — fog-safe and stable (#396)', () => {
  const entryFor = (over: Partial<JournalEventInput>) => buildAbsenceJournal([event(over)]).entries[0]

  it('names the entity and nothing else', () => {
    // WorldEvent.reason is GM-grade — tick handlers write it for the admin
    // debug viewer and it routinely names undiscovered actors. Nothing here
    // may read it, which is why the entry shape does not even carry it.
    const entry = entryFor({ targetType: 'WAR', field: 'warDeclared', targetName: 'The Rustwatch' })

    expect(entry).not.toHaveProperty('reason')
    expect(describeJournalEntry(entry)).toContain('The Rustwatch')
  })

  it('falls back to a category line for a field it has no template for', () => {
    const entry = entryFor({ targetType: 'CLOCK', field: 'someNewField', targetName: 'The Siege' })

    expect(describeJournalEntry(entry)).toContain('The Siege')
  })

  it('reads the same way every time for the same entry', () => {
    // A recap that reworded itself on refresh would read as the world having
    // changed again.
    const entry = entryFor({ targetType: 'FACTION', field: 'collapsed', targetName: 'Ashcrown Company' })

    expect(describeJournalEntry(entry)).toBe(describeJournalEntry(entry))
  })
})
