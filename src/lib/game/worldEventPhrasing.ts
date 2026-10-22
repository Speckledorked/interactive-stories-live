// src/lib/game/worldEventPhrasing.ts
//
// How a WorldEvent is NAMED to players, in one place (#522).
//
// Two independent problems make this a module rather than a renderer's
// business, and they pull in the same direction:
//
//  1. **WorldEvent.reason is unshowable.** It is the simulation's own
//     account of why it made a call, and api/campaigns/[id]/world-events
//     is admin-gated precisely because it "can reference GM-only state (a
//     hidden faction's scheme, an undiscovered NPC's plan) the same way
//     gmNotes can". Every player-facing read of this table therefore has
//     to say what moved WITHOUT the field that says why. That leaves the
//     structured columns, which need turning into sentences somewhere.
//
//  2. **The raw columns read as a spreadsheet.** Tick deltas are small
//     integers (logisticsTick's worked slot is +2; factionTick's ENRICH is
//     +4). A feed of "resources 42 -> 44" is a worse answer than showing
//     nothing: it makes a world that is genuinely alive look like a
//     ledger, and it invites players to optimise numbers the design
//     deliberately keeps off-screen. So previousValue/newValue are read
//     for their DIRECTION and then discarded.
//
// Three readers share this: the per-character knowledge surface (#520),
// the world chronicle (#522) and the since-you-last-looked diff (#523). A
// phrasing that must be identical in three places is the same argument
// consequenceLabels.ts already makes for its own four categories.
//
// Dependency-free (no Prisma, no React) so a 'use client' component and a
// route handler can share the vocabulary — the same split as
// visibility.ts, worldStateChanges.ts and campaignHealthBands.ts.

/**
 * Which way a numeric field moved. 'unknown' covers every non-numeric
 * change — a weather string, a boolean flag, a plan swap — where the fact
 * of the change is the whole content and there is no direction to read.
 */
export type ChangeDirection = 'up' | 'down' | 'flat' | 'unknown'

/**
 * Coarse grouping for the UI to hang an icon or a section heading on.
 * Deliberately broader than WorldEventTargetType: a player thinks in
 * "someone", "somewhere", "a war", not in the eleven entity types the tick
 * handlers are organised by.
 */
export type WorldEventKind = 'power' | 'territory' | 'war' | 'people' | 'place' | 'thread'

export interface PhrasedWorldEvent {
  /** One player-facing sentence. Never contains a raw value or a reason. */
  text: string
  kind: WorldEventKind
}

/** The columns phrasing reads. A subset of WorldEvent, so a caller can
 *  select narrowly and cannot accidentally pass `reason` in. */
export interface PhraseableEvent {
  /** `${targetType.toLowerCase()}.${field}` — see tick/worldEventLog.ts's typeFor. */
  type: string
  targetName: string
  previousValue?: string | null
  newValue?: string | null
}

/**
 * Read a direction out of the two value columns.
 *
 * Both columns are `String?` in the schema regardless of the underlying
 * field's type, so "did this go up" is a parse, not a comparison. A pair
 * that does not parse as two numbers is 'unknown' rather than 'flat':
 * "stormy" -> "clear" genuinely changed, and calling that flat would drop
 * a real event.
 */
export function changeDirection(
  previousValue?: string | null,
  newValue?: string | null
): ChangeDirection {
  const before = Number(previousValue)
  const after = Number(newValue)
  if (previousValue == null || newValue == null) return 'unknown'
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 'unknown'
  if (after > before) return 'up'
  if (after < before) return 'down'
  return 'flat'
}

/**
 * A phrasing for one event type.
 *
 * `up`/`down` are only consulted for fields that have a direction; a
 * field whose change is its own content (a declared war, a spawned
 * thread) supplies `flat` alone and ignores the values entirely.
 */
interface Phrasing {
  kind: WorldEventKind
  up?: (name: string) => string
  down?: (name: string) => string
  /** Used when there is no direction to read, and as the fallback. */
  flat?: (name: string) => string
}

/**
 * The vocabulary, keyed on WorldEvent.type.
 *
 * ABSENT MEANS SILENT, and that is the safety property: a tick handler
 * that starts writing a new field reaches players as nothing at all until
 * someone writes a sentence for it here. The alternative — a generic
 * "faction.beliefVector changed" fallback — would leak internal field
 * names into the fiction the first time anyone added a handler, which is
 * exactly the kind of decay a lookup table makes visible instead.
 *
 * Several types are deliberately mapped to nothing and listed in
 * SILENT_TYPES below rather than merely omitted, so the distinction
 * between "no sentence yet" and "decided not to show this" survives.
 */
const PHRASINGS: Record<string, Phrasing> = {
  // --- factions: standing in the world ---
  'faction.resources': {
    kind: 'power',
    up: (n) => `${n} has grown wealthier.`,
    down: (n) => `${n}'s coffers are thinning.`,
  },
  'faction.stability': {
    kind: 'power',
    up: (n) => `${n} has steadied itself.`,
    down: (n) => `${n} is fraying at the edges.`,
  },
  'faction.influence': {
    kind: 'power',
    up: (n) => `${n}'s reach is widening.`,
    down: (n) => `${n}'s reach is narrowing.`,
  },
  'faction.threat': {
    kind: 'power',
    up: (n) => `${n} has become more dangerous.`,
    down: (n) => `${n} has become less of a danger.`,
  },
  'faction.debt': {
    kind: 'power',
    up: (n) => `${n} has fallen deeper into obligation.`,
    down: (n) => `${n} has settled some of what it owed.`,
  },
  'faction.collapsed': {
    kind: 'power',
    flat: (n) => `${n} has come apart.`,
  },

  // --- factions: ground ---
  'faction.territoryClaimed': {
    kind: 'territory',
    flat: (n) => `${n} has taken new ground.`,
  },
  'faction.territoryContested': {
    kind: 'territory',
    flat: (n) => `${n}'s hold on its ground is being challenged.`,
  },

  // --- factions: war ---
  // Four separate types rather than one: warTick writes them at different
  // moments and a player reading a feed wants the difference between
  // "started one" and "got dragged into one".
  'faction.warDeclared': { kind: 'war', flat: (n) => `${n} has declared war.` },
  'faction.warJoined': { kind: 'war', flat: (n) => `${n} has joined a war already under way.` },
  'faction.warEnded': { kind: 'war', flat: (n) => `${n}'s war has ended.` },
  'faction.warResolved': { kind: 'war', flat: (n) => `${n}'s war has been decided.` },

  // --- factions: ambitions ---
  // Phrased without naming the object of the ambition. The ambition's
  // target may itself be undiscovered, and the fog helper gates the row's
  // OWN target, not whatever that target is pointed at.
  'faction.ambitionCommitted': {
    kind: 'power',
    flat: (n) => `${n} has committed itself to something larger.`,
  },
  'faction.ambitionTargeted': {
    kind: 'power',
    flat: (n) => `${n} has drawn someone's attention.`,
  },
  'faction.ambitionResolved': {
    kind: 'power',
    flat: (n) => `${n}'s ambition has run its course.`,
  },

  // --- people ---
  'npc.currentLocation': { kind: 'people', flat: (n) => `${n} has moved on.` },
  'npc.currentPlan': { kind: 'people', flat: (n) => `${n} is set on something new.` },
  'npc.goal': { kind: 'people', flat: (n) => `${n} has turned to a new purpose.` },
  'npc.goalCompleted': {
    kind: 'people',
    flat: (n) => `${n} has finished what they set out to do.`,
  },
  'npc.factionRole': {
    kind: 'people',
    flat: (n) => `${n}'s standing among their own has changed.`,
  },
  'npc.jointScheme': { kind: 'people', flat: (n) => `${n} has found an accomplice.` },
  'npc.relationship': { kind: 'people', flat: (n) => `${n}'s ties to someone have shifted.` },
  // Disposition is held toward a specific party, and the row does not say
  // which. "warmer toward you" would be a guess, and wrong whenever the
  // shift was toward a faction or another NPC.
  'npc.disposition': {
    kind: 'people',
    up: (n) => `${n}'s mood has softened.`,
    down: (n) => `${n}'s mood has hardened.`,
  },

  // --- places ---
  'location_weather.weather': { kind: 'place', flat: (n) => `The weather over ${n} has turned.` },
  'location_condition.conditionScore': {
    kind: 'place',
    up: (n) => `${n} is recovering.`,
    down: (n) => `${n} is in worse shape than it was.`,
  },
  'location_population.population': {
    kind: 'place',
    up: (n) => `${n} is more crowded than it was.`,
    down: (n) => `${n} is emptier than it was.`,
  },
  'location_population.populationFlight': {
    kind: 'place',
    flat: (n) => `People are leaving ${n}.`,
  },

  // --- threads (Clock, as /world names it) ---
  'clock.spawned': { kind: 'thread', flat: (n) => `Something new is in motion: ${n}.` },
  'clock.currentTicks': {
    kind: 'thread',
    up: (n) => `${n} has drawn closer.`,
    down: (n) => `${n} has been pushed back.`,
  },
}

/**
 * Types that exist, are written every turn, and are deliberately NOT
 * shown to players — recorded here so the next reader can tell a decision
 * from an oversight.
 *
 *  - faction.agendaContinued: the tick noting that nothing changed. Real
 *    for the simulation, noise in a feed.
 *  - faction.beliefVector: beliefTick's internal drift numbers, with no
 *    fictional reading at all.
 *  - faction.clockResolutionEffect: plumbing — the mechanical follow-on
 *    from a resolved clock, which surfaces as its own effects anyway.
 */
export const SILENT_TYPES = new Set([
  'faction.agendaContinued',
  'faction.beliefVector',
  'faction.clockResolutionEffect',
])

/**
 * Turn one event into a sentence, or null when it has no player-facing
 * phrasing.
 *
 * Null is a normal outcome, not an error: callers drop the row. Fails
 * closed on an unmapped type for the reason PHRASINGS' own comment gives,
 * and on a blank targetName, since every sentence here is built around a
 * name and `"'s coffers are thinning"` is not worth showing anyone.
 */
export function phraseWorldEvent(event: PhraseableEvent): PhrasedWorldEvent | null {
  if (SILENT_TYPES.has(event.type)) return null
  const phrasing = PHRASINGS[event.type]
  if (!phrasing) return null

  const name = event.targetName?.trim()
  if (!name) return null

  const direction = changeDirection(event.previousValue, event.newValue)
  const render =
    (direction === 'up' && phrasing.up) ||
    (direction === 'down' && phrasing.down) ||
    phrasing.flat ||
    null

  // A directional field that moved the one way it has no sentence for, or
  // did not move at all, is nothing to report.
  if (!render) return null

  return { text: render(name), kind: phrasing.kind }
}

/** Every type with a sentence. Exported for the guard test that keeps this
 *  table and the tick handlers' own vocabulary from drifting apart. */
export function phrasedTypes(): string[] {
  return Object.keys(PHRASINGS)
}
