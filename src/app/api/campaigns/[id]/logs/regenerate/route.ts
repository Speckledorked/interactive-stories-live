// src/app/api/campaigns/[id]/logs/regenerate/route.ts
// Retroactively re-summarize existing Story Log entries. The old
// generateCampaignLog was a placeholder that regex-truncated scene text
// instead of actually summarizing it (see sceneResolver.ts); entries
// written before that fix still carry the truncated, malformed output.
// There's no way to redo those for free — the AI response that would
// have carried scene_summary/new_timeline_events is long gone, only
// Scene.sceneResolutionText survives — so this makes a fresh, dedicated
// (cheap, EFFICIENT-model) summarization call per entry.
//
// Also consolidates duplicate rows first: a separate, earlier bug in
// generateCampaignLog created one row per exchange instead of one per
// scene, and that fix doesn't touch rows already sitting in the table -
// see storyLogConsolidation.ts. Consolidation is a cheap DB-only pass
// (no AI calls) run across every duplicate in one request; only the
// AI-resummarization pass afterward is capped.
//
// Admin-gated (unlike regenerate-intro, which any member can trigger):
// this fans out multiple AI calls in one request, which per-scene
// regeneration doesn't, so it's a real cost/abuse surface. Capped per
// request to stay well inside the Hobby-tier maxDuration=60 window
// without needing a dedicated async job type for what's expected to be a
// rare maintenance action.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { prisma } from '@/lib/prisma'
import { summarizeSceneForLog } from '@/lib/ai/worldState'
import { planLogConsolidation } from '@/lib/game/storyLogConsolidation'
import { AI_ACTION_LIMIT, checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'

export const maxDuration = 60

const MAX_ENTRIES_PER_REQUEST = 25

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id

    const rateLimit = await checkRateLimit(user.userId, AI_ACTION_LIMIT.bucket, AI_ACTION_LIMIT.limit, AI_ACTION_LIMIT.windowSeconds)
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId
        }
      }
    })

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Only campaign admins can regenerate Story Log entries' },
        { status: 403 }
      )
    }

    // Consolidate first: cheap (no AI calls), so process every duplicate
    // in one request regardless of the resummarization cap below.
    const allSceneEntries = await prisma.campaignLog.findMany({
      where: { campaignId, entryType: 'scene', sceneId: { not: null } },
      select: { id: true, sceneId: true, turnNumber: true, highlights: true }
    })

    const consolidationPlans = planLogConsolidation(allSceneEntries)
    let consolidated = 0
    for (const plan of consolidationPlans) {
      await prisma.campaignLog.deleteMany({ where: { id: { in: plan.deleteIds } } })
      await prisma.campaignLog.update({
        where: { id: plan.canonicalId },
        data: { highlights: plan.mergedHighlights }
      })
      consolidated += plan.deleteIds.length
    }

    const entries = await prisma.campaignLog.findMany({
      where: { campaignId, sceneId: { not: null } },
      orderBy: { turnNumber: 'asc' },
      take: MAX_ENTRIES_PER_REQUEST,
      select: { id: true, sceneId: true }
    })

    if (entries.length === 0) {
      return NextResponse.json({ regenerated: 0, failed: 0, remaining: 0, consolidated })
    }

    const scenes = await prisma.scene.findMany({
      where: { id: { in: entries.map(e => e.sceneId as string) } },
      select: { id: true, sceneResolutionText: true }
    })
    const sceneTextById = new Map(scenes.map(s => [s.id, s.sceneResolutionText]))

    let regenerated = 0
    let failed = 0

    for (const entry of entries) {
      const sceneText = entry.sceneId ? sceneTextById.get(entry.sceneId) : null
      if (!sceneText) {
        failed++
        continue
      }

      try {
        const { summary, highlights } = await summarizeSceneForLog(campaignId, sceneText)
        await prisma.campaignLog.update({
          where: { id: entry.id },
          data: { summary, highlights }
        })
        regenerated++
      } catch (error) {
        console.error(`⚠️ Failed to regenerate Story Log entry ${entry.id}:`, error)
        failed++
      }
    }

    const remaining = await prisma.campaignLog.count({
      where: { campaignId, sceneId: { not: null } }
    }) - MAX_ENTRIES_PER_REQUEST

    return NextResponse.json({
      regenerated,
      failed,
      remaining: Math.max(0, remaining),
      consolidated
    })
  } catch (error) {
    console.error('❌ Story Log regeneration error:', error)

    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json<ErrorResponse>(
      {
        error: 'Failed to regenerate Story Log entries',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
