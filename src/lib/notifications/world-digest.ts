// src/lib/notifications/world-digest.ts
// The world-visibility digest: the living simulation's drama, pushed to
// players instead of sitting silently in the database. After each world
// turn, the tick's MAJOR changes involving entities the party has
// actually discovered become one "word on the street" notification per
// campaign member — the retention hook for a world that moves offscreen.
//
// Fog of war note: tick `reason` strings are GM-grade (they can name
// undiscovered factions — see the admin debug viewer), so the digest
// never uses them. Each line is built from a per-field template plus the
// (already discovery-filtered) entity name only.

import { prisma } from '@/lib/prisma'
import { NotificationService } from './notification-service'
import type { WorldChange } from '@/lib/game/tick/types'

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
      return `Word is that ${name} answers to new leadership.`
    default:
      return `There's talk of upheaval around ${name}.`
  }
}

/**
 * Send the post-tick digest. Best-effort by design: any failure logs and
 * returns 0 — the world turn must never fail because a notification did.
 * Returns the number of members notified.
 */
export async function sendWorldDigest(
  campaignId: string,
  changes: WorldChange[]
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

    await Promise.all(
      members.map(m =>
        NotificationService.createNotification({
          type: 'WORLD_EVENT',
          title: 'Word on the street…',
          message,
          userId: m.userId,
          campaignId,
          actionUrl: `/campaigns/${campaignId}/story-log`,
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
