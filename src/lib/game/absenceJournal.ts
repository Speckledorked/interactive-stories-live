// src/lib/game/absenceJournal.ts
//
// #396: what a player can reconstruct after being away.
//
// The product promise is a world that moves while you are gone. Every
// surface that reports that movement was built as a NOTIFICATION —
// transient, capped, latest-wins — and none of them was the durable record:
//
//   world digest      3 lines per turn, faction/NPC only, push-then-gone
//   away recap        the last 5 TimelineEvents, whatever they happened
//                     to be about
//   rumors            take: 50, AI-narrated offscreen events only
//   chronicle         regenerated per turn and OVERWRITTEN
//
// Each is individually reasonable and individually capped. Nothing was the
// floor, so there was no floor: come back after thirty world turns and
// everything about locations, weather, clocks, quests, wars and the economy
// was unreconstructible from any player surface at all.
//
// ── The decision this file makes ──────────────────────────────────────────
//
// **The durable record is `WorldEvent`.** Not a new table. WorldEvent is
// already append-only, already written once per turn per change by every
// tick handler, already covers all twelve entity types, already carries a
// dedupeKey so a replayed turn does not duplicate it (#377), and already
// has a stated retention policy (retention.ts, #409). It has been the
// complete record all along. What was missing is that NO PLAYER SURFACE
// READ IT — every one of them read TimelineEvent, which only exists for the
// AI-narrated offscreen events and structurally cannot carry a weather
// change or a clock tick.
//
// So the digest and the recap become VIEWS over WorldEvent, and this file
// is the selection those views share.
//
// ── Why coverage-first, not recency-first ─────────────────────────────────
//
// The old recap took the five most recent events. Over thirty turns that is
// thirty turns of the world reduced to the last one, and the categories
// that produce the most rows (weather, NPC plans) crowd out the ones that
// matter most (a war started, a faction fell). Selection here takes the
// most significant event from EACH CATEGORY first — so a returning player
// is guaranteed to hear about every KIND of thing that happened — and only
// then fills the remaining slots by significance and recency.
//
// That is the actual floor the issue asked for: not "more events", but "no
// category of change can be silently absent".

import type { WorldEventTargetType } from '@prisma/client'
import { stableHash } from '@/lib/game/tick/types'

/**
 * Player-facing groupings of WorldEvent.targetType. Deliberately coarser
 * than the enum: a player thinks "something happened with the weather round
 * there", not "LOCATION_WEATHER vs LOCATION_CONDITION".
 */
export type AbsenceCategory = 'factions' | 'people' | 'places' | 'clocks' | 'quests' | 'wars' | 'economy'

export const CATEGORY_BY_TARGET_TYPE: Record<string, AbsenceCategory> = {
  FACTION: 'factions',
  NPC: 'people',
  CHARACTER: 'people',
  LOCATION_WEATHER: 'places',
  LOCATION_CONDITION: 'places',
  LOCATION_POPULATION: 'places',
  CLOCK: 'clocks',
  QUEST: 'quests',
  WAR: 'wars',
  DEBT: 'economy',
}

/**
 * Order the categories are offered in when filling coverage slots. Wars and
 * factions first because a shifted balance of power is the thing a player
 * most needs to know before acting; weather last because it is the loudest
 * category by row count and the least consequential per row.
 */
export const CATEGORY_PRIORITY: readonly AbsenceCategory[] = [
  'wars',
  'factions',
  'quests',
  'clocks',
  'people',
  'economy',
  'places',
]

export interface JournalEventInput {
  id: string
  turnNumber: number
  createdAt: Date
  targetType: WorldEventTargetType | string
  targetId: string
  targetName: string
  field: string
  significant: boolean
  importance: string
}

export interface JournalEntry extends JournalEventInput {
  category: AbsenceCategory
}

/** How many entries a reconstruction offers. Twelve, not five: see below. */
export const MAX_JOURNAL_ENTRIES = 12

export function categoryOf(targetType: string): AbsenceCategory | null {
  return CATEGORY_BY_TARGET_TYPE[targetType] ?? null
}

/**
 * Total order over events, most-worth-reporting first.
 *
 * Fully deterministic, and deliberately NOT dependent on turnNumber alone.
 * The audit found the old ordering was `orderBy turnNumber desc` with no
 * tiebreak, which over a frozen turn counter (#374) meant every row tied
 * and which five survived was whatever Postgres returned — the surface that
 * was supposed to summarise an absence was picking arbitrarily. The turn
 * counter is fixed now; the ordering still does not rely on it being the
 * only discriminator.
 */
export function compareJournalEvents(a: JournalEventInput, b: JournalEventInput): number {
  const byImportance = Number(b.importance === 'MAJOR') - Number(a.importance === 'MAJOR')
  if (byImportance !== 0) return byImportance
  const bySignificance = Number(b.significant) - Number(a.significant)
  if (bySignificance !== 0) return bySignificance
  const byTurn = b.turnNumber - a.turnNumber
  if (byTurn !== 0) return byTurn
  const byTime = b.createdAt.getTime() - a.createdAt.getTime()
  if (byTime !== 0) return byTime
  return a.id.localeCompare(b.id)
}

export interface AbsenceJournal {
  entries: JournalEntry[]
  /** Every category that had at least one event in the window. */
  categoriesPresent: AbsenceCategory[]
  /** Total events in the window, including ones that did not make the cut. */
  totalEvents: number
  /** Lowest and highest simulation turn the window spans. */
  turnRange: { from: number; to: number } | null
}

/**
 * Pure: reconstruct an absence from the durable record.
 *
 * Coverage first — the single most-worth-reporting event from every
 * category present, in CATEGORY_PRIORITY order — then the rest by the same
 * total order until the budget is spent. Guarantees that if anything at all
 * happened in a category, the player hears about that category.
 */
export function buildAbsenceJournal(
  events: JournalEventInput[],
  maxEntries: number = MAX_JOURNAL_ENTRIES
): AbsenceJournal {
  const classified: JournalEntry[] = []
  for (const event of events) {
    const category = categoryOf(String(event.targetType))
    if (category) classified.push({ ...event, category })
  }

  if (classified.length === 0) {
    return { entries: [], categoriesPresent: [], totalEvents: 0, turnRange: null }
  }

  const ordered = [...classified].sort(compareJournalEvents)

  const byCategory = new Map<AbsenceCategory, JournalEntry[]>()
  for (const entry of ordered) {
    const bucket = byCategory.get(entry.category)
    if (bucket) bucket.push(entry)
    else byCategory.set(entry.category, [entry])
  }

  const categoriesPresent = CATEGORY_PRIORITY.filter((c) => byCategory.has(c))

  const chosen: JournalEntry[] = []
  const taken = new Set<string>()

  // Pass 1 — coverage. One per category, best first, in priority order, so
  // that a budget too small for every category spends it on the ones that
  // change what a player would do next.
  for (const category of categoriesPresent) {
    if (chosen.length >= maxEntries) break
    const best = byCategory.get(category)![0]
    chosen.push(best)
    taken.add(best.id)
  }

  // Pass 2 — depth. Fill what is left by the same total order.
  for (const entry of ordered) {
    if (chosen.length >= maxEntries) break
    if (taken.has(entry.id)) continue
    chosen.push(entry)
    taken.add(entry.id)
  }

  const turns = classified.map((e) => e.turnNumber)

  return {
    // Presented oldest-first: a reconstruction reads as a story, not a feed.
    entries: chosen.sort((a, b) => -compareJournalEvents(a, b)),
    categoriesPresent,
    totalEvents: classified.length,
    turnRange: { from: Math.min(...turns), to: Math.max(...turns) },
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────
//
// WorldEvent.reason is GM-GRADE. It is written by tick handlers for the
// admin debug viewer and routinely names undiscovered factions, unrevealed
// motives and offscreen actors ("Winter scarcity strains the Ashcrown
// Company's resources" is harmless; "The Hollow Choir moves against a
// target it has not revealed" is not). world-digest.ts already learned this
// and builds its lines from a per-field template plus the entity name only.
// Same discipline here — nothing below ever touches `reason`.

const FIELD_LINES: Record<string, (name: string) => string[]> = {
  warDeclared: (n) => [`${n} went to war while you were away.`],
  warResolved: (n) => [`${n}'s war came to an end.`],
  warEnded: (n) => [`${n}'s war came to an end.`],
  collapsed: (n) => [`${n} fell apart entirely.`],
  founded: (n) => [`${n} rose to prominence.`],
  leader: (n) => [`${n} answers to new leadership now.`],
  leadership: (n) => [`${n} answers to new leadership now.`],
  factionRole: (n) => [`${n} answers to new leadership now.`],
  resources: (n) => [`${n}'s fortunes shifted.`],
  stability: (n) => [`${n} grew less steady.`],
  weather: (n) => [`The weather over ${n} turned.`],
  conditionScore: (n) => [`${n} is not in the state you left it.`],
  population: (n) => [`People moved through ${n} — it is busier or emptier than it was.`],
  currentTicks: (n) => [`The clock on ${n} moved closer to striking.`],
  status: (n) => [`${n}'s standing changed.`],
  goal: (n) => [`${n} is pursuing something new.`],
}

const CATEGORY_FALLBACK: Record<AbsenceCategory, (name: string) => string> = {
  wars: (n) => `Something shifted in the war around ${n}.`,
  factions: (n) => `Something shifted around ${n}.`,
  quests: (n) => `${n} moved on without you.`,
  clocks: (n) => `${n} advanced while you were away.`,
  people: (n) => `${n} has been busy.`,
  economy: (n) => `Money moved around ${n}.`,
  places: (n) => `${n} changed while you were away.`,
}

/**
 * Pure, fog-safe, deterministic one-line description of a journal entry.
 * Deterministic on the entry's own id so the same absence always reads the
 * same way — a recap that reworded itself on refresh would read as the
 * world having changed again.
 */
export function describeJournalEntry(entry: JournalEntry): string {
  const variants = FIELD_LINES[entry.field]?.(entry.targetName)
  if (!variants || variants.length === 0) return CATEGORY_FALLBACK[entry.category](entry.targetName)
  return variants[stableHash(entry.id) % variants.length]
}

/** Human label for a category heading. */
export const CATEGORY_LABELS: Record<AbsenceCategory, string> = {
  wars: 'Wars',
  factions: 'Powers',
  quests: 'Jobs',
  clocks: 'Countdowns',
  people: 'People',
  economy: 'Debts and coin',
  places: 'Places',
}
