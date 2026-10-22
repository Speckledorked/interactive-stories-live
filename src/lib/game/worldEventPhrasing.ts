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
// FOUR readers share this, and the fourth is why the table is shaped the
// way it is. #396's absence journal already had a phrasing table for this
// column — FIELD_LINES, keyed on the bare `field`, with the same reasoning
// written above it ("WorldEvent.reason is GM-GRADE... nothing below ever
// touches reason") and, before it, world-digest.ts's per-field templates.
// This module shipped as a second one. Two tables phrasing the same column
// for players is precisely what consequenceLabels.ts's own comment
// forbids: "a label that must be identical in two renderers is not a
// component's business."
//
// So FIELD_LINES moved here, and there are now two layers rather than two
// tables:
//
//   PHRASINGS   keyed on `targetType.field`, and can therefore read a
//               DIRECTION off the value columns and distinguish the same
//               field on different entity types.
//   FIELD_LINES keyed on the bare `field`, for the cases where the field
//               means the same thing wherever it appears, and where the
//               caller has no values to read a direction from. This is
//               #396's reviewed copy, kept verbatim.
//
// The type layer wins when it matches, because it is strictly better
// informed. The journal keeps its own CATEGORY_FALLBACK on top of both —
// that one is keyed on an AbsenceCategory, which is a journal concept and
// not a property of the event.
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
    // Every directional entry carries a flat form too. A caller that did
    // not select previousValue/newValue (the absence journal does not)
    // still deserves a sentence, and falling through to a category
    // fallback would make the recap vaguer than it was before this table
    // existed. The flat wording is #396's.
    flat: (n) => `${n}'s fortunes shifted.`,
  },
  'faction.stability': {
    kind: 'power',
    up: (n) => `${n} has steadied itself.`,
    down: (n) => `${n} is fraying at the edges.`,
    // #396's line was `${n} grew less steady.` unconditionally, which was
    // wrong half the time — the same row is written when stability RISES.
    // Directional above; neutral here.
    flat: (n) => `${n}'s footing changed.`,
  },
  'faction.influence': {
    kind: 'power',
    up: (n) => `${n}'s reach is widening.`,
    down: (n) => `${n}'s reach is narrowing.`,
    flat: (n) => `${n}'s reach has shifted.`,
  },
  'faction.threat': {
    kind: 'power',
    up: (n) => `${n} has become more dangerous.`,
    down: (n) => `${n} has become less of a danger.`,
    flat: (n) => `${n} is regarded differently now.`,
  },
  'faction.debt': {
    kind: 'power',
    up: (n) => `${n} has fallen deeper into obligation.`,
    down: (n) => `${n} has settled some of what it owed.`,
    flat: (n) => `What ${n} owes has changed.`,
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
    flat: (n) => `${n} regards things differently now.`,
  },

  // --- places ---
  'location_weather.weather': { kind: 'place', flat: (n) => `The weather over ${n} has turned.` },
  'location_condition.conditionScore': {
    kind: 'place',
    up: (n) => `${n} is recovering.`,
    down: (n) => `${n} is in worse shape than it was.`,
    flat: (n) => `${n} is not in the state you left it.`,
  },
  'location_population.population': {
    kind: 'place',
    up: (n) => `${n} is more crowded than it was.`,
    down: (n) => `${n} is emptier than it was.`,
    flat: (n) => `People moved through ${n} — it is busier or emptier than it was.`,
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
    flat: (n) => `The thread on ${n} moved.`,
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
 * The second layer: #396's FIELD_LINES, keyed on the bare `field` and
 * moved here verbatim rather than rewritten.
 *
 * These cover fields that mean the same thing on every entity type they
 * appear on, including several the type layer above has no key for at all
 * (`founded`, `leader`, `status` — written against QUEST and WAR targets,
 * which the tick handlers reach through paths the type table does not
 * enumerate). Arrays because the journal selects deterministically among
 * variants; all of them happen to hold one line today.
 *
 * `kind` is assigned per field so a caller that groups by kind gets
 * something sensible out of this layer too.
 */
const FIELD_LINES: Record<string, { kind: WorldEventKind; texts: Array<(name: string) => string> }> = {
  warDeclared: { kind: 'war', texts: [(n) => `${n} went to war while you were away.`] },
  warResolved: { kind: 'war', texts: [(n) => `${n}'s war came to an end.`] },
  warEnded: { kind: 'war', texts: [(n) => `${n}'s war came to an end.`] },
  collapsed: { kind: 'power', texts: [(n) => `${n} fell apart entirely.`] },
  founded: { kind: 'power', texts: [(n) => `${n} rose to prominence.`] },
  leader: { kind: 'people', texts: [(n) => `${n} answers to new leadership now.`] },
  leadership: { kind: 'people', texts: [(n) => `${n} answers to new leadership now.`] },
  factionRole: { kind: 'people', texts: [(n) => `${n} answers to new leadership now.`] },
  resources: { kind: 'power', texts: [(n) => `${n}'s fortunes shifted.`] },
  stability: { kind: 'power', texts: [(n) => `${n}'s footing changed.`] },
  weather: { kind: 'place', texts: [(n) => `The weather over ${n} turned.`] },
  conditionScore: { kind: 'place', texts: [(n) => `${n} is not in the state you left it.`] },
  population: {
    kind: 'place',
    texts: [(n) => `People moved through ${n} — it is busier or emptier than it was.`],
  },
  currentTicks: { kind: 'thread', texts: [(n) => `The thread on ${n} moved closer to striking.`] },
  status: { kind: 'power', texts: [(n) => `${n}'s standing changed.`] },
  goal: { kind: 'people', texts: [(n) => `${n} is pursuing something new.`] },
}

/** The field half of a `targetType.field` type key. */
function fieldOf(type: string): string {
  const dot = type.indexOf('.')
  return dot === -1 ? type : type.slice(dot + 1)
}

/**
 * Every sentence this module would accept for one event, most specific
 * first, or null when it has none.
 *
 * Exposed alongside phraseWorldEvent for the one caller that wants to pick
 * among variants itself: the absence journal selects deterministically on
 * the event's own id, so the same absence always reads the same way.
 * Keeping that selection at the call site means this module does not need
 * a hashing dependency.
 */
export function phraseWorldEventVariants(
  event: PhraseableEvent
): { texts: string[]; kind: WorldEventKind } | null {
  if (SILENT_TYPES.has(event.type)) return null

  const name = event.targetName?.trim()
  // Every sentence here is built around a name, and `"'s coffers are
  // thinning"` is not worth showing anyone.
  if (!name) return null

  const phrasing = PHRASINGS[event.type]
  if (phrasing) {
    const direction = changeDirection(event.previousValue, event.newValue)
    const render =
      (direction === 'up' && phrasing.up) ||
      (direction === 'down' && phrasing.down) ||
      phrasing.flat ||
      null
    if (render) return { texts: [render(name)], kind: phrasing.kind }
  }

  // Fall through to the field layer rather than returning null: a type the
  // first table has no key for may still be a field the second one knows.
  const byField = FIELD_LINES[fieldOf(event.type)]
  if (byField) return { texts: byField.texts.map((t) => t(name)), kind: byField.kind }

  return null
}

/**
 * Turn one event into a sentence, or null when it has no player-facing
 * phrasing.
 *
 * Null is a normal outcome, not an error: callers drop the row, or supply
 * their own fallback. Fails closed on a type neither layer knows, for the
 * reason PHRASINGS' own comment gives.
 */
export function phraseWorldEvent(event: PhraseableEvent): PhrasedWorldEvent | null {
  const variants = phraseWorldEventVariants(event)
  if (!variants) return null
  return { text: variants.texts[0], kind: variants.kind }
}

/** Every type with a sentence in the first layer. Exported for the guard
 *  test that keeps this table and the tick handlers' own vocabulary from
 *  drifting apart. */
export function phrasedTypes(): string[] {
  return Object.keys(PHRASINGS)
}

/** Every bare field the second layer phrases. Same purpose. */
export function phrasedFields(): string[] {
  return Object.keys(FIELD_LINES)
}
