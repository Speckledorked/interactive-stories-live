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

// At most this many rumor lines per turn — a digest, not a firehose.
export const MAX_DIGEST_LINES = 3

/**
 * #395: entity types that ARE subject to discovery.
 *
 * Only NPCs and factions have an isDiscovered flag — a location, a clock,
 * a quest, a war or a debt is not something the party "learns exists" in
 * the same modelled sense (visibility.ts gates four models; locations and
 * clocks are not among them).
 *
 * This distinction is the whole bug. The gate below used to test
 * `discoveredEntityIds.has(c.entityId)` for EVERY change, and the set was
 * built from faction and NPC ids only — so a LOCATION_WEATHER or CLOCK or
 * WAR id could never be in it, and every such change was structurally
 * unreachable. weatherTick.ts:144-153 emits storms explicitly flagged
 * importance: 'MAJOR'; they were computed, written to WorldEvent, and then
 * silently dropped with no player-visible record anywhere.
 *
 * "This type has no discovery concept" was being read as "this entity is
 * undiscovered".
 */
export const DISCOVERY_GATED_ENTITY_TYPES: ReadonlySet<TickEntityType> = new Set<TickEntityType>([
  'NPC',
  'FACTION',
])

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

function defaultLines(names: string[]): string[] {
  const who = joinNames(names)
  return [
    `There's talk of upheaval around ${who}.`,
    `Something is shifting around ${who} — the details are still unclear.`,
  ]
}

const LINE_GENERATORS: Record<string, (names: string[]) => string[]> = {
  warDeclared: warDeclaredLines,
  warJoined: warJoinedLines,
  warResolved: warResolvedLines,
  warEnded: warResolvedLines,
  collapsed: collapsedLines,
  founded: foundedLines,
  leader: leadershipLines,
  leadership: leadershipLines,
  factionRole: leadershipLines,
}

/**
 * Pure: one diegetic rumor line for a group of one or more changes sharing
 * a field. Templates deliberately name only the changes' own entities —
 * opponents/absorbers may be undiscovered. The variant is picked
 * deterministically from the affected entities' ids, so the exact same
 * set of changes always renders the same way (reproducible, testable) —
 * this is not random, it just isn't the single fixed sentence it used to be.
 */
export function formatDigestGroupLine(changes: WorldChange[]): string {
  if (changes.length === 0) return ''
  const names = changes.map(c => c.entityName)
  const variants = (LINE_GENERATORS[changes[0].field] ?? defaultLines)(names)
  const seed = changes.map(c => c.entityId).sort().join('|')
  return variants[stableHash(seed) % variants.length]
}

/** Convenience for a single change — see formatDigestGroupLine for the real logic. */
export function formatDigestLine(change: WorldChange): string {
  return formatDigestGroupLine([change])
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
    default:
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
  currentTurn: number,
  inGameDayNumber?: number
): Promise<number> {
  try {
    if (changes.length === 0) return 0

    // Discovery gate: the union of discovered factions and NPCs. Only
    // those two types model discovery at all — see
    // DISCOVERY_GATED_ENTITY_TYPES for why building this set was not the
    // bug, and testing every change against it was.
    const [factions, npcs, members] = await Promise.all([
      prisma.faction.findMany({
        where: { campaignId, isDiscovered: true },
        select: { id: true },
      }),
      prisma.nPC.findMany({
        where: { campaignId, isDiscovered: true },
        select: { id: true },
      }),
      prisma.campaignMembership.findMany({
        where: { campaignId },
        select: { userId: true },
      }),
    ])
    const discovered = new Set([...factions.map(f => f.id), ...npcs.map(n => n.id)])

    const selected = selectDigestChanges(changes, discovered)
    if (selected.length === 0 || members.length === 0) return 0

    // Grouped, not one line per raw change — several factions settling new
    // leadership in the same tick (a real, common case, see
    // leadershipTick.ts) used to produce one near-identical line per
    // faction; grouping collapses same-field changes into a single
    // combined line and frees the remaining digest budget for whatever
    // else actually happened this turn.
    const groups = groupDigestChangesByField(selected)
    const lines = groups.map(formatDigestGroupLine)
    const message = lines.join('\n')

    // Journal: independent try/catch — a journal-write failure must not
    // cost players the notification itself, the same reasoning behind
    // catching each member's notification individually below.
    await prisma.timelineEvent.createMany({
      data: groups.map(group => ({
        campaignId,
        turnNumber: currentTurn,
        title: titleForDigestChange(group[0]),
        summaryPublic: formatDigestGroupLine(group),
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
