// src/lib/game/campaignMilestone.ts
// Every CAMPAIGN_MILESTONE_INTERVAL scenes, write a short AI retrospective
// into the Story Log and notify the party. This is what the campaign hub's
// "Milestone at 20 scenes" progress bar always implied was happening but
// never actually did - the bar was purely decorative, hardcoded to /20 with
// no logic behind it.

import { prisma } from '@/lib/prisma'
import { generateMilestoneRecap } from '@/lib/ai/worldState'
import { NotificationService } from '@/lib/notifications/notification-service'

export const CAMPAIGN_MILESTONE_INTERVAL = 20

/**
 * Given the campaign's current count of scene-type Story Log entries
 * (after the latest one was just created), decide whether a milestone
 * just triggered. Pure so it's unit-testable without a database.
 */
export function isMilestoneTurn(sceneLogCount: number): boolean {
  return sceneLogCount > 0 && sceneLogCount % CAMPAIGN_MILESTONE_INTERVAL === 0
}

/**
 * Best-effort: create the milestone Story Log entry and notify every
 * member. Never throws - called right after a new scene's own log entry
 * is created (see sceneResolver.ts's generateCampaignLog), and a missed
 * milestone must never take that real entry down with it.
 */
export async function checkAndCreateMilestone(
  campaignId: string,
  sceneLogCount: number,
  latestTurnNumber: number
): Promise<void> {
  if (!isMilestoneTurn(sceneLogCount)) return

  try {
    const recentEntries = await prisma.campaignLog.findMany({
      where: { campaignId, entryType: 'scene' },
      orderBy: { turnNumber: 'desc' },
      take: CAMPAIGN_MILESTONE_INTERVAL,
      select: { summary: true, highlights: true }
    })
    if (recentEntries.length === 0) return

    // Oldest first, so the recap reads in chronological order.
    const orderedSummaries = recentEntries.slice().reverse().map(e => e.summary)
    const recap = await generateMilestoneRecap(campaignId, orderedSummaries)

    const mergedHighlights = Array.from(new Set(recentEntries.flatMap(e => e.highlights))).slice(0, 8)

    await prisma.campaignLog.create({
      data: {
        campaignId,
        turnNumber: latestTurnNumber,
        title: `Milestone: ${sceneLogCount} Scenes`,
        summary: recap,
        highlights: mergedHighlights,
        entryType: 'milestone'
      }
    })

    const members = await prisma.campaignMembership.findMany({
      where: { campaignId },
      select: { userId: true }
    })

    await Promise.all(
      members.map(m =>
        NotificationService.createNotification({
          type: 'CAMPAIGN_MILESTONE',
          title: `🏆 Milestone: ${sceneLogCount} scenes chronicled`,
          message: recap,
          userId: m.userId,
          campaignId,
          actionUrl: `/campaigns/${campaignId}/story-log`,
          metadata: { sceneLogCount }
        }).catch((err: unknown) => {
          console.error('Milestone notification failed (non-critical):', err)
        })
      )
    )

    console.log(`🏆 Campaign milestone reached: ${sceneLogCount} scenes (${campaignId})`)
  } catch (error) {
    console.error('Campaign milestone generation failed (non-critical):', error)
  }
}
