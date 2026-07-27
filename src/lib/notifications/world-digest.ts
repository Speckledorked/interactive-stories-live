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
import type { WorldChange } from '@/lib/game/tick/types'
import type { EventType, EventVisibility } from '@prisma/client'

// At most this many rumor lines per turn — a digest, not a firehose.
export const MAX_DIGEST_LINES = 3

/**
 * Pure: which tick changes are digest-worthy. MAJOR + significant only
 * (the tick already curates importance), and only for entities in the
 * discovered set — the party can't hear street talk about a faction
 * whose existence they haven't learned.
 */
export function selectDigestChanges(
  changes: WorldChange[],
  discoveredEntityIds: Set<string>
): WorldChange[] {
  return changes
    .filter(c => c.significant && c.importance === 'MAJOR' && discoveredEntityIds.has(c.entityId))
    .slice(0, MAX_DIGEST_LINES)
}

/**
 * Pure: one diegetic rumor line per change. Templates deliberately name
 * only the change's own entity — opponents/absorbers may be undiscovered.
 */
export function formatDigestLine(change: WorldChange): string {
  const name = change.entityName
  switch (change.field) {
    case 'warDeclared':
      return `${name} has declared war — armies are moving and the roads grow dangerous.`
    case 'warJoined':
      return `${name} has thrown its strength into the war.`
    case 'warResolved':
    case 'warEnded':
      return `The war ${name} was fighting is over. The balance of power has shifted.`
    case 'collapsed':
      return `${name} has fallen. Its people scatter, and someone will fill the void.`
    case 'founded':
      return `A new power calling itself ${name} is making its presence felt.`
    case 'leader':
    case 'leadership':
    case 'factionRole':
      return `Word is that ${name} answers to new leadership.`
    default:
      return `There's talk of upheaval around ${name}.`
  }
}

/**
 * Pure: a short category title for the journal entry (the Rumors tab
 * renders title and summary as separate fields — see wiki/page.tsx's
 * RUMORS view). Mirrors formatDigestLine's cases exactly; kept as a
 * separate function rather than returning a tuple so formatDigestLine's
 * existing signature and callers stay untouched.
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
  currentTurn: number
): Promise<number> {
  try {
    if (changes.length === 0) return 0

    // Discovery gate: the union of discovered factions and NPCs is the
    // only world the players know to hear rumors about.
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

    const lines = selected.map(formatDigestLine)
    const message = lines.join('\n')

    // Journal: independent try/catch — a journal-write failure must not
    // cost players the notification itself, the same reasoning behind
    // catching each member's notification individually below.
    await prisma.timelineEvent.createMany({
      data: selected.map(change => ({
        campaignId,
        turnNumber: currentTurn,
        title: titleForDigestChange(change),
        summaryPublic: formatDigestLine(change),
        isOffscreen: true,
        visibility: 'PUBLIC' as EventVisibility,
        eventType: 'WORLD_EVENT' as EventType,
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
