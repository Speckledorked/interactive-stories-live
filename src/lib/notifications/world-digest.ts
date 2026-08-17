// src/lib/notifications/world-digest.ts
// The world-visibility digest: the living simulation's drama, pushed to
// players instead of sitting silently in the database. After each world
// turn, the tick's MAJOR changes involving entities the party has
// actually discovered become one "word on the street" notification per
// campaign member — the retention hook for a world that moves offscreen.
//
// The notification alone used to be the only record — its actionUrl
// pointed at the Story Log, which never actually contained the digest's
// text. Each digest-worthy change is now also written as a permanent,
// player-readable TimelineEvent (isOffscreen, PUBLIC), the same feed
// worldTurnOffscreenEvents.ts's AI-generated events already write into
// and the Rumors tab (/campaigns/[id]/wiki?type=RUMORS) already reads —
// so "word on the street" survives past the transient notification that
// announced it, instead of being a second, disconnected logging path.
//
// Fog of war note: tick `reason` strings are GM-grade (they can name
// undiscovered factions — see the admin debug viewer), so the digest
// never uses them. Each line is built from a per-field template plus the
// (already discovery-filtered) entity name only.

import { prisma } from '@/lib/prisma'
import { NotificationService } from './notification-service'
import type { WorldChange, TickEntityType } from '@/lib/game/tick/types'
import { stableHash } from '@/lib/game/tick/types'
import type { EventType, EventVisibility } from '@prisma/client'
import type { SimTurn } from '@/lib/game/turnClock'

// At most this many rumor lines per turn — a digest, not a firehose.
export const MAX_DIGEST_LINES = 3

/**
 * #395: entity types that ARE subject to discovery.
 *
 * The gate below used to test `discoveredEntityIds.has(c.entityId)` for
 * EVERY change against a set built from faction and NPC ids only — so a
 * LOCATION_WEATHER or CLOCK or WAR id could never be in it, and every such
 * change was structurally unreachable. weatherTick.ts emits severe storms
 * flagged importance: 'MAJOR'; they were computed, written to WorldEvent,
 * and then silently dropped. "This type has no discovery concept" was
 * being read as "this entity is undiscovered".
 *
 * That fix was right about the bug and wrong about the facts. It recorded
 * that "locations and clocks are not among" visibility.ts's four fog-gated
 * models — but they are exactly two of the four
 * (`FogGatedModel = 'npc' | 'faction' | 'location' | 'clock'`), and
 * `Location.isDiscovered` has existed all along. So LOCATION* changes went
 * from never reaching players to reaching them UNGATED: a severe storm at
 * a location the party had never found was broadcast by name to everyone.
 *
 * Locations are gated here now, against discovered location ids. Clocks
 * are gated the other way round (`isHidden`) and emit no MAJOR digest
 * change today; if one is ever added it must be gated too, which is why
 * this set is keyed on the type rather than on "does this id happen to be
 * in the set".
 */
/**
 * Each gated entity type, and the model whose discovered rows supply the
 * ids it is checked against.
 *
 * The gate and the id set are derived from this ONE table on purpose. They
 * used to be two independent lists, and #432 changed one without the
 * other: it added the LOCATION* types to the gate and left the id set
 * built from factions and NPCs only, so every location change began
 * failing a check against a set that could never contain it. That inverted
 * the leak into a total blackout, and made the weatherLines generator
 * written in the same commit unreachable.
 *
 * Adding a type here now brings its id source with it, because there is
 * only one place to add it.
 */
const DISCOVERY_SOURCE_BY_ENTITY_TYPE = {
  NPC: 'nPC',
  FACTION: 'faction',
  LOCATION: 'location',
  LOCATION_WEATHER: 'location',
  LOCATION_CONDITION: 'location',
  LOCATION_POPULATION: 'location',
} as const satisfies Partial<Record<TickEntityType, 'nPC' | 'faction' | 'location'>>

/** The models to query for discovered ids — deduplicated, since the four
 * LOCATION* types all resolve through Location. */
export const DISCOVERY_SOURCE_MODELS = [
  ...new Set(Object.values(DISCOVERY_SOURCE_BY_ENTITY_TYPE)),
] as Array<'nPC' | 'faction' | 'location'>

export const DISCOVERY_GATED_ENTITY_TYPES: ReadonlySet<TickEntityType> = new Set(
  Object.keys(DISCOVERY_SOURCE_BY_ENTITY_TYPE) as TickEntityType[]
)

/**
 * Pure: which tick changes are digest-worthy. MAJOR + significant only
 * (the tick already curates importance).
 *
 * Discovery is checked per ENTITY TYPE, not per id: types that model
 * discovery must be discovered; types that don't pass through. Deliberately
 * NOT capped here — see groupDigestChangesByField, which caps groups
 * instead of raw changes so a burst of same-field changes (e.g. several
 * factions settling new leadership the same tick — leadershipTick.ts runs
 * against every faction missing a living leader, so this happens easily
 * early in a campaign) can't crowd out other, more varied digest-worthy
 * changes from the same turn.
 */
export function selectDigestChanges(
  changes: WorldChange[],
  discoveredEntityIds: Set<string>
): WorldChange[] {
  return changes.filter((c) => {
    if (!c.significant || c.importance !== 'MAJOR') return false
    // #432: MAJOR means "the tick thought this mattered", which is not the
    // same as "this is something people would gossip about". An
    // importance-5 NPC's routine movement is MAJOR every turn. Only fields
    // with an authored rumor phrasing get through — see LINE_GENERATORS.
    if (!isRumorWorthy(c)) return false
    if (DISCOVERY_GATED_ENTITY_TYPES.has(c.entityType)) return discoveredEntityIds.has(c.entityId)
    return true
  })
}

/**
 * Pure: collapse changes sharing the same field into one group each,
 * preserving first-seen field order, then cap to MAX_DIGEST_LINES groups.
 * This is what turns three separate "new leadership" changes in one tick
 * into one combined rumor line instead of three near-identical ones, and
 * it's also why capping moved here from selectDigestChanges: capping raw
 * changes first could burn the whole budget on duplicates of one field
 * before a different, more interesting change ever got a chance to render.
 */
export function groupDigestChangesByField(changes: WorldChange[]): WorldChange[][] {
  const order: string[] = []
  const groups = new Map<string, WorldChange[]>()
  for (const c of changes) {
    if (!groups.has(c.field)) {
      groups.set(c.field, [])
      order.push(c.field)
    }
    groups.get(c.field)!.push(c)
  }
  return order.slice(0, MAX_DIGEST_LINES).map(field => groups.get(field)!)
}

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

// Several phrasing variants per field, instead of one fixed sentence —
// the same event type recurring (which it does: leadership succession in
// particular can fire for several factions in the same tick) used to
// always render identically bar the name, which read as repetitive and
// made the world feel less alive than the tick actually is. Every
// generator handles both a single entity and a joined group, since
// groupDigestChangesByField above may hand it more than one.
function warDeclaredLines(names: string[]): string[] {
  const who = joinNames(names)
  const verb = names.length === 1 ? 'has' : 'have'
  return [
    `${who} ${verb} declared war — armies are moving and the roads grow dangerous.`,
    `${who} ${verb} declared war and broken the peace. War drums sound.`,
    `Word spreads that ${who} ${verb} declared war.`,
  ]
}

function warJoinedLines(names: string[]): string[] {
  const who = joinNames(names)
  const verb = names.length === 1 ? 'has' : 'have'
  const possessive = names.length === 1 ? 'its' : 'their'
  return [
    `${who} ${verb} thrown ${possessive} strength into the war.`,
    `${who} ${verb} joined the fighting.`,
  ]
}

function warResolvedLines(names: string[]): string[] {
  const who = joinNames(names)
  const verb = names.length === 1 ? 'was' : 'were'
  return [
    `The war ${who} ${verb} fighting is over. The balance of power has shifted.`,
    `Fighting involving ${who} is over — the dust is still settling.`,
  ]
}

function collapsedLines(names: string[]): string[] {
  const who = joinNames(names)
  const verb = names.length === 1 ? 'has' : 'have'
  const possessive = names.length === 1 ? 'Its' : 'Their'
  return [
    `${who} ${verb} fallen. ${possessive} people scatter, and someone will fill the void.`,
    `${who} ${verb} fallen — the vacuum won't stay empty for long.`,
  ]
}

function foundedLines(names: string[]): string[] {
  const who = joinNames(names)
  const verb = names.length === 1 ? 'is' : 'are'
  const reflexive = names.length === 1 ? 'itself' : 'themselves'
  const possessive = names.length === 1 ? 'its' : 'their'
  return [
    `A new power calling ${reflexive} ${who} ${verb} making ${possessive} presence felt.`,
    `Word has it that ${who} ${verb} rising.`,
  ]
}

function leadershipLines(names: string[]): string[] {
  const who = joinNames(names)
  const verb = names.length === 1 ? 'answers' : 'answer'
  const hasVerb = names.length === 1 ? 'has' : 'have'
  const isVerb = names.length === 1 ? 'is' : 'are'
  return [
    `Word is that ${who} ${verb} to new leadership now.`,
    `Talk says ${who} ${hasVerb} stepped into new leadership.`,
    `${who} ${isVerb} said to be answering to new leadership these days.`,
  ]
}

// #432: the seven MAJOR-emitting fields that had no template at all.
//
// Every one of them fell through to a two-sentence generic fallback, and
// the most narratively interesting events in the simulation — a faction
// seizing ground, a scheme paying off, an NPC finishing what they set out
// to do — all came out as "Something is shifting around X".

function goalCompletedLines(names: string[]): string[] {
  const who = joinNames(names)
  const verb = names.length === 1 ? 'has' : 'have'
  const possessive = names.length === 1 ? 'their' : 'their'
  return [
    `${who} ${verb} finished what ${names.length === 1 ? 'they' : 'they'} set out to do.`,
    `Whatever ${who} ${names.length === 1 ? 'was' : 'were'} working toward, it is done.`,
    `${who} ${verb} seen ${possessive} plans through to the end.`,
  ]
}

function ambitionCommittedLines(names: string[]): string[] {
  const who = joinNames(names)
  const verb = names.length === 1 ? 'is' : 'are'
  return [
    `${who} ${verb} putting real weight behind something new.`,
    `There is movement inside ${who} — a scheme taking shape.`,
    `Something is being set in motion within ${who}.`,
  ]
}

/**
 * The one generator that reads the change's own values rather than only
 * its entity names: `newValue` is 'succeeded' or 'failed', which is the
 * difference between a triumph and a debacle. A single phrasing for both
 * would be worse than no rumor.
 */
function ambitionResolvedLines(names: string[], changes: WorldChange[]): string[] {
  const who = joinNames(names)
  const verb = names.length === 1 ? 'has' : 'have'
  const possessive = names.length === 1 ? 'its' : 'their'
  const succeeded = changes.every(c => c.newValue === 'succeeded')
  if (succeeded) {
    return [
      `${possessive === 'its' ? 'The' : 'The'} scheme ${who} ${verb} been running has paid off.`,
      `${who} ${verb} got what ${possessive} manoeuvring was for.`,
      `Whatever ${who} ${verb} been arranging, it worked.`,
    ]
  }
  const failed = changes.every(c => c.newValue === 'failed')
  if (failed) {
    return [
      `${possessive === 'its' ? 'The' : 'The'} scheme ${who} ${verb} been running has come apart.`,
      `${who} overreached, and it shows.`,
      `Whatever ${who} ${verb} been arranging has failed.`,
    ]
  }
  // A mixed group — some succeeded, some failed. Saying either would be
  // false for half of them.
  return [
    `Schemes involving ${who} have run their course, with mixed results.`,
    `The manoeuvring around ${who} has settled — not everyone came out ahead.`,
  ]
}

/**
 * Territory changes name the entity that GAINED or LOST ground, never the
 * counterparty or the location. `previousValue` is the other faction's
 * name and `newValue` is the location's — both may be undiscovered, and
 * naming either here would be the exact leak the module doc warns about.
 */
function territoryClaimedLines(names: string[]): string[] {
  const who = joinNames(names)
  const verb = names.length === 1 ? 'holds' : 'hold'
  const hasVerb = names.length === 1 ? 'has' : 'have'
  return [
    `${who} ${verb} ground ${names.length === 1 ? 'it' : 'they'} did not hold before.`,
    `${who} ${hasVerb} taken territory, and someone else ${hasVerb} lost it.`,
    `The map has changed in ${who}'s favour.`,
  ]
}

function territoryContestedLines(names: string[]): string[] {
  const who = joinNames(names)
  const possessive = names.length === 1 ? 'its' : 'their'
  const isVerb = names.length === 1 ? 'is' : 'are'
  return [
    `${who} ${isVerb} losing ${possessive} grip on land ${names.length === 1 ? 'it' : 'they'} used to hold uncontested.`,
    `Someone is pressing ${who} where ${names.length === 1 ? 'it' : 'they'} used to be unchallenged.`,
    `${possessive === 'its' ? 'Its' : 'Their'} hold slipping, ${who} ${isVerb} being tested on ${possessive} own ground.`,
  ]
}

function importanceLines(names: string[]): string[] {
  const who = joinNames(names)
  const isVerb = names.length === 1 ? 'is' : 'are'
  const nameWord = names.length === 1 ? 'a name' : 'names'
  return [
    `${who} ${isVerb} becoming ${nameWord} people repeat.`,
    `More people know who ${who} ${isVerb} than did a while ago.`,
    `${who} ${isVerb} being spoken of far past where ${names.length === 1 ? 'they' : 'they'} started.`,
  ]
}

function weatherLines(names: string[]): string[] {
  const who = joinNames(names)
  const isVerb = names.length === 1 ? 'is' : 'are'
  return [
    `The weather has turned hard against ${who}.`,
    `Travellers are warning each other away from ${who}.`,
    `${who} ${isVerb} taking the worst of the weather.`,
  ]
}

/**
 * #432: an ALLOWLIST, not a fallback table.
 *
 * There used to be a `defaultLines` catch-all here, and it was the whole
 * problem. `importance: 'MAJOR'` is not a judgement about newsworthiness —
 * npcTick sets it from `npc.importance >= 5`, so an importance-5 NPC's
 * routine daily movement (`currentLocation`) and plan-phase advance
 * (`currentPlan`) were MAJOR every single turn. Neither had a template, so
 * both rendered as the generic sentence, turn after turn, for the same
 * NPC. That is the "recycled" feeling: not a phrasing shortage, a firehose
 * of non-events wearing one phrase.
 *
 * A field with no entry here is not a rumor. Someone walking to the market
 * is not word on the street, and no amount of phrasing variety would make
 * it so. This also fails safe as the simulation grows: a newly added MAJOR
 * field stays out of the digest until somebody decides what it should
 * SOUND like, instead of silently joining the generic pile.
 */
const LINE_GENERATORS: Record<string, (names: string[], changes: WorldChange[]) => string[]> = {
  warDeclared: warDeclaredLines,
  warJoined: warJoinedLines,
  warResolved: warResolvedLines,
  warEnded: warResolvedLines,
  collapsed: collapsedLines,
  founded: foundedLines,
  leader: leadershipLines,
  leadership: leadershipLines,
  factionRole: leadershipLines,
  goalCompleted: goalCompletedLines,
  ambitionCommitted: ambitionCommittedLines,
  ambitionResolved: ambitionResolvedLines,
  territoryClaimed: territoryClaimedLines,
  territoryContested: territoryContestedLines,
  importance: importanceLines,
  weather: weatherLines,
}

/** Whether this change has an authored rumor phrasing — i.e. whether it is
 * a rumor at all. See LINE_GENERATORS for why this is an allowlist. */
export function isRumorWorthy(change: WorldChange): boolean {
  return change.field in LINE_GENERATORS
}

/**
 * Pure: one diegetic rumor line for a group of one or more changes sharing
 * a field. Templates deliberately name only the changes' own entities —
 * opponents/absorbers may be undiscovered. The variant is picked
 * deterministically from the affected entities' ids, so the exact same
 * set of changes always renders the same way (reproducible, testable) —
 * this is not random, it just isn't the single fixed sentence it used to be.
 */
export function formatDigestGroupLine(changes: WorldChange[], turnNumber = 0): string {
  if (changes.length === 0) return ''
  const generator = LINE_GENERATORS[changes[0].field]
  if (!generator) return ''
  const names = changes.map(c => c.entityName)
  const variants = generator(names, changes)
  // #432: the TURN is part of the seed. It used to be the entity ids
  // alone, which made the phrasing a pure function of who was involved —
  // so a recurring event about the same faction produced a byte-identical
  // sentence every turn forever. Still deterministic (same turn, same
  // entities, same text: reproducible and testable), it just no longer
  // reads as a copy-paste when the world repeats itself.
  const seed = `${turnNumber}|${changes.map(c => c.entityId).sort().join('|')}`
  return variants[stableHash(seed) % variants.length]
}

/** Convenience for a single change — see formatDigestGroupLine for the real logic. */
export function formatDigestLine(change: WorldChange, turnNumber = 0): string {
  return formatDigestGroupLine([change], turnNumber)
}

/**
 * Pure: a short category title for the journal entry (the Rumors tab
 * renders title and summary as separate fields — see wiki/page.tsx's
 * RUMORS view). Mirrors the line generators' field cases exactly; kept as
 * a separate function rather than returning a tuple so callers that only
 * want a title aren't forced to also compute a line.
 */
export function titleForDigestChange(change: WorldChange): string {
  switch (change.field) {
    case 'warDeclared':
      return 'War Declared'
    case 'warJoined':
      return 'New Ally in the War'
    case 'warResolved':
    case 'warEnded':
      return 'War Ended'
    case 'collapsed':
      return 'A Power Has Fallen'
    case 'founded':
      return 'A New Power Rises'
    case 'leader':
    case 'leadership':
    case 'factionRole':
      return 'New Leadership'
    case 'goalCompleted':
      return 'A Purpose Fulfilled'
    case 'ambitionCommitted':
      return 'Something Set in Motion'
    case 'ambitionResolved':
      return 'A Scheme Runs Its Course'
    case 'territoryClaimed':
      return 'The Map Redrawn'
    case 'territoryContested':
      return 'A Hold Slipping'
    case 'importance':
      return 'A Name People Repeat'
    case 'weather':
      return 'Foul Weather'
    default:
      // #432: no longer reachable from the digest — selectDigestChanges
      // drops any field without an authored phrasing, and every field with
      // one has a title above. Kept as a real title rather than a throw
      // because this function is exported and a caller outside the digest
      // should get something renderable, not an exception.
      return 'Word on the Street'
  }
}

/**
 * Send the post-tick digest. Best-effort by design: any failure logs and
 * returns 0 — the world turn must never fail because a notification did.
 * Returns the number of members notified.
 */
export async function sendWorldDigest(
  campaignId: string,
  changes: WorldChange[],
  // #437: the SIMULATION turn — this is a world-turn phase, and the
  // TimelineEvent journal rows below are a sim-clock column.
  currentTurn: SimTurn,
  inGameDayNumber?: number
): Promise<number> {
  try {
    if (changes.length === 0) return 0

    // Discovery gate: the union of discovered factions and NPCs. Only
    // those two types model discovery at all — see
    // DISCOVERY_GATED_ENTITY_TYPES for why building this set was not the
    // bug, and testing every change against it was.
    // Driven off DISCOVERY_SOURCE_MODELS rather than a hand-written list,
    // so a type added to the gate cannot be missing its ids here.
    const [idSets, members] = await Promise.all([
      Promise.all(
        DISCOVERY_SOURCE_MODELS.map(model =>
          (prisma[model] as { findMany: (args: unknown) => Promise<Array<{ id: string }>> }).findMany({
            where: { campaignId, isDiscovered: true },
            select: { id: true },
          })
        )
      ),
      prisma.campaignMembership.findMany({
        where: { campaignId },
        select: { userId: true },
      }),
    ])
    const discovered = new Set(idSets.flat().map(row => row.id))

    const selected = selectDigestChanges(changes, discovered)
    if (selected.length === 0 || members.length === 0) return 0

    // Grouped, not one line per raw change — several factions settling new
    // leadership in the same tick (a real, common case, see
    // leadershipTick.ts) used to produce one near-identical line per
    // faction; grouping collapses same-field changes into a single
    // combined line and frees the remaining digest budget for whatever
    // else actually happened this turn.
    const groups = groupDigestChangesByField(selected)
    const lines = groups.map(group => formatDigestGroupLine(group, currentTurn))
    const message = lines.join('\n')

    // Journal: independent try/catch — a journal-write failure must not
    // cost players the notification itself, the same reasoning behind
    // catching each member's notification individually below.
    await prisma.timelineEvent.createMany({
      data: groups.map(group => ({
        campaignId,
        turnNumber: currentTurn,
        title: titleForDigestChange(group[0]),
        summaryPublic: formatDigestGroupLine(group, currentTurn),
        isOffscreen: true,
        visibility: 'PUBLIC' as EventVisibility,
        eventType: 'WORLD_EVENT' as EventType,
        inGameDayNumber,
      })),
    }).catch((err: unknown) => {
      console.error('World digest journal write failed (non-critical):', err)
    })

    await Promise.all(
      members.map(m =>
        NotificationService.createNotification({
          type: 'WORLD_EVENT',
          title: 'Word on the street…',
          message,
          userId: m.userId,
          campaignId,
          actionUrl: `/campaigns/${campaignId}/wiki?type=RUMORS`,
          metadata: { digest: true, lineCount: lines.length },
        }).catch((err: unknown) => {
          console.error('World digest notification failed (non-critical):', err)
        })
      )
    )

    console.log(`📣 World digest sent to ${members.length} member(s): ${lines.length} line(s)`)
    return members.length
  } catch (error) {
    console.error('World digest failed (non-critical):', error)
    return 0
  }
}
