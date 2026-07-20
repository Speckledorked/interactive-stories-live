// src/lib/game/campaignMilestone.ts
// Every CAMPAIGN_MILESTONE_INTERVAL scenes, write a short AI retrospective
// into the Story Log and notify the party. This is what the campaign hub's
// "Milestone at 20 scenes" progress bar always implied was happening but
// never actually did - the bar was purely decorative, hardcoded to /20 with
// no logic behind it.

import { prisma } from '@/lib/prisma'
import { generateMilestoneRecap } from '@/lib/ai/worldState'
import { NotificationService } from '@/lib/notifications/notification-service'
import { pickMostThreateningFaction, decideCrisisEscalation } from './tick/crisisClock'

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
 * The "something world-changing" half of a milestone: deterministically
 * escalate the single most threatening active faction's plan (see
 * tick/crisisClock.ts) rather than just narrating that the milestone
 * happened. Returns a blurb to fold into the milestone's Story Log entry
 * and notification, or null if the campaign has no active faction yet to
 * threaten anyone with.
 */
async function triggerMilestoneCrisis(campaignId: string, turnNumber: number): Promise<string | null> {
  const factions = await prisma.faction.findMany({
    where: { campaignId, isActive: true },
    select: { id: true, name: true, threatLevel: true, military: true, resources: true }
  })
  const threat = pickMostThreateningFaction(factions)
  if (!threat) return null

  const existingClock = await prisma.clock.findFirst({
    where: { campaignId, sourceFactionId: threat.id, currentTicks: { lt: prisma.clock.fields.maxTicks } },
    select: { id: true, name: true, currentTicks: true, maxTicks: true }
  })

  const decision = decideCrisisEscalation(existingClock)

  let clockName: string
  if (decision.action === 'escalate' && existingClock) {
    await prisma.clock.update({ where: { id: existingClock.id }, data: { currentTicks: decision.newTicks } })
    clockName = existingClock.name
  } else if (decision.action === 'spawn') {
    clockName = `${threat.name}'s Reckoning`
    await prisma.clock.create({
      data: {
        campaignId,
        name: clockName,
        description: `${threat.name} has moved decisively — their ambitions are accelerating toward a breaking point.`,
        category: 'urgent',
        maxTicks: decision.spawnMaxTicks,
        currentTicks: decision.spawnStartTicks,
        consequence: `${threat.name} achieves a decisive advantage over its rivals`,
        sourceFactionId: threat.id
      }
    })
  } else {
    return null
  }

  const blurb = decision.action === 'escalate'
    ? `Meanwhile, ${threat.name}'s plans have accelerated — ${clockName} draws closer to completion.`
    : `Meanwhile, ${threat.name} has moved decisively — a new threat looms: ${clockName}.`

  await prisma.timelineEvent.create({
    data: {
      campaignId,
      turnNumber,
      title: decision.action === 'escalate' ? `${threat.name} escalates` : clockName,
      summaryPublic: blurb,
      summaryGM: blurb,
      isOffscreen: true,
      visibility: 'PUBLIC'
    }
  }).catch((err: unknown) => console.error('Crisis timeline event failed (non-critical):', err))

  return blurb
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

    // A milestone isn't just a look back - the world moves too. Best-effort
    // and independent of the recap above: a crisis failure never blocks the
    // real milestone entry from being written.
    const crisisBlurb = await triggerMilestoneCrisis(campaignId, latestTurnNumber).catch((err: unknown) => {
      console.error('Milestone crisis trigger failed (non-critical):', err)
      return null
    })
    const fullSummary = crisisBlurb ? `${recap} ${crisisBlurb}` : recap

    const mergedHighlights = Array.from(new Set(recentEntries.flatMap(e => e.highlights))).slice(0, 8)

    await prisma.campaignLog.create({
      data: {
        campaignId,
        turnNumber: latestTurnNumber,
        title: `Milestone: ${sceneLogCount} Scenes`,
        summary: fullSummary,
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
          message: fullSummary,
          userId: m.userId,
          campaignId,
          actionUrl: `/campaigns/${campaignId}/story-log`,
          metadata: { sceneLogCount, crisis: Boolean(crisisBlurb) }
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
