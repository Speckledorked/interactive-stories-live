// src/lib/lore/seedingGate.ts
// Play lock for creation-time world seeding. A campaign created with a
// canon lore source is UNPLAYABLE (no characters, no scenes) until the
// import + auto-reseed finishes — otherwise a character created mid-import
// would flip the reseed from fresh-mode (replace the provisional world)
// into live-mode (additive), stranding the placeholder world the lore was
// supposed to replace.
//
// The flag is cleared by the worker (reseed done, or the import
// permanently failed). Because a worker can die between those steps, the
// gate self-heals: a flag with no live import job behind it — after a
// grace window for the reseed itself — is cleared on the next check, so
// no campaign can stay locked forever. Checks also piggyback the stale-
// job recovery sweep, so player polling keeps a stuck import moving even
// when no admin is watching the Lore tab.

import { prisma } from '@/lib/prisma'
import { recoverStaleLoreJobs } from './loreQueue'
import { clearPendingWorldSeed } from './reseedWorld'

// How long after the last auto-reseed job finished importing we still
// consider "the reseed is probably running" before declaring the flag
// stale. The reseed is two AI calls (~a minute at worst).
export const SEED_STALE_GRACE_MS = 5 * 60 * 1000

/**
 * Pure: is a set pendingWorldSeed flag stale? Stale means no live import
 * job remains AND the newest auto-reseed job (if any) finished longer ago
 * than the grace window — i.e. whatever was supposed to clear the flag
 * died. No job at all is immediately stale (job creation failed after the
 * flag was set).
 */
export function seedFlagIsStale(
  liveJobCount: number,
  newestJobFinishedAt: Date | null,
  nowMs: number
): boolean {
  if (liveJobCount > 0) return false
  if (!newestJobFinishedAt) return true
  return nowMs - newestJobFinishedAt.getTime() >= SEED_STALE_GRACE_MS
}

/**
 * Is this campaign's world still being seeded from canon lore? Routes
 * that start play (character creation, scene start) call this and reject
 * with SEEDING_MESSAGE while it returns true.
 */
export async function isWorldSeeding(campaignId: string): Promise<boolean> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { pendingWorldSeed: true },
  })
  if (!campaign?.pendingWorldSeed) return false

  const jobs = await prisma.loreImportJob.findMany({
    where: { campaignId, autoReseedOnComplete: true },
    select: { status: true, finishedAt: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })
  const liveCount = jobs.filter(j => j.status === 'PENDING' || j.status === 'RUNNING').length
  const newest = jobs[0] ?? null
  const newestFinishedAt = newest ? newest.finishedAt ?? newest.updatedAt : null

  if (seedFlagIsStale(liveCount, newestFinishedAt, Date.now())) {
    await clearPendingWorldSeed(campaignId)
    console.warn(`🌱 pendingWorldSeed self-healed for campaign ${campaignId} (no live seeding work behind it)`)
    return false
  }

  // Still genuinely seeding — make sure the import isn't silently stuck
  // (lost kick, dead worker). Player traffic is the retry loop here, same
  // philosophy as scene-resolution recovery.
  if (liveCount > 0) {
    await recoverStaleLoreJobs(campaignId)
  }
  return true
}

export const SEEDING_MESSAGE =
  'The world is still being forged from your canon lore — check back in a few minutes.'
