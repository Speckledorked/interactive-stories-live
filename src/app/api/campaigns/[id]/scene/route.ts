// src/app/api/campaigns/[id]/scene/route.ts
// Scene management
// GET - Get current scene
// POST - Submit player action

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { SubmitActionRequest, ErrorResponse } from '@/types/api'
import { pusherServer } from '@/lib/pusher'
import { AI_ACTION_LIMIT, checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { moderatePlayerText } from '@/lib/ai/moderation'
import { recordEvent } from '@/lib/analytics/events'

// POST can trigger a full scene resolution (AI GM call + world tick) inline
// before responding. 60s is the Vercel Hobby-tier ceiling — safe on every
// plan — and well above the typical resolution time; it's not a guarantee
// against a pathologically slow AI response, just a large improvement over
// the platform's unconfigured default.
export const maxDuration = 60

// GET active scenes
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id

    // Check membership
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId
        }
      }
    })

    if (!membership) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Not a member of this campaign' },
        { status: 403 }
      )
    }

    // Opportunistic stale-job recovery: players staring at a stuck scene
    // refresh this route — that's the retry loop for lost/crashed
    // resolution jobs. Best-effort, never blocks the read.
    try {
      const { recoverStaleJobs } = await import('@/lib/game/resolutionQueue')
      await recoverStaleJobs(campaignId)
    } catch (recoveryError) {
      console.error('Stale job recovery failed (non-critical):', recoveryError)
    }

    // Get all active scenes (awaiting_actions or resolving)
    const activeScenes = await prisma.scene.findMany({
      where: {
        campaignId,
        status: {
          in: ['AWAITING_ACTIONS', 'RESOLVING']
        }
      },
      include: {
        playerActions: {
          where: {
            status: 'pending'
          },
          include: {
            character: true,
            user: {
              select: { id: true, email: true }
            }
          }
        },
        // Ask-the-GM: out-of-character Q&A, visible to the whole party —
        // never a PlayerAction, never mechanically consequential (see
        // GmClarification's schema doc).
        gmClarifications: {
          include: {
            character: { select: { id: true, name: true } }
          },
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { sceneNumber: 'desc' }
    })

    // Opportunistic reconciliation of a historical bug: actions orphaned
    // by an exchangeNumber/currentExchange divergence that could occur
    // on a scene's first exchange (see exchange-manager.ts's
    // reconcileOrphanedActions) could look permanently "already
    // submitted" to the player. Swept actions are filtered out of this
    // response too, so the fix is visible without a second reload.
    for (const scene of activeScenes) {
      if (scene.playerActions.length === 0) continue
      try {
        const { ExchangeManager } = await import('@/lib/game/exchange-manager')
        const swept = await new ExchangeManager(campaignId, scene.id).reconcileOrphanedActions()
        if (swept.length > 0) {
          console.warn(`🔧 Reconciled ${swept.length} orphaned action(s) on scene ${scene.sceneNumber}`)
          const sweptIds = new Set(swept)
          scene.playerActions = scene.playerActions.filter(a => !sweptIds.has(a.id))
        }
      } catch (reconcileError) {
        console.error('Orphaned action reconciliation failed (non-critical):', reconcileError)
      }
    }

    // For backwards compatibility, also return the first scene as "scene"
    const currentScene = activeScenes.length > 0 ? activeScenes[0] : null

    return NextResponse.json({ scene: currentScene, scenes: activeScenes })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('Get scene error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Submit action for current scene
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id
    const body: SubmitActionRequest = await request.json()

    const { sceneId, characterId, actionText } = body

    // Validate input
    if (!sceneId || !characterId || !actionText) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Scene ID, character ID, and action text are required' },
        { status: 400 }
      )
    }

    // Rate limit before any DB/AI work — action submission can trigger a
    // full scene resolution (an LLM call) inline.
    const rateLimit = await checkRateLimit(user.userId, AI_ACTION_LIMIT.bucket, AI_ACTION_LIMIT.limit, AI_ACTION_LIMIT.windowSeconds)
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    // Provider-ToS input moderation — flagged free-text never reaches the
    // completion model. Distinct from the X-Card safety tool. Strictness
    // is per-campaign (see settings/ai/route.ts); "standard" doesn't
    // block plain violence, since that's expected content in a combat RPG.
    const campaignForModeration = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { contentModerationLevel: true },
    })
    const moderationLevel = campaignForModeration?.contentModerationLevel === 'strict' ? 'strict' : 'standard'
    const moderation = await moderatePlayerText(actionText, moderationLevel)
    if (moderation.flagged) {
      return NextResponse.json<ErrorResponse>(
        { error: `Your action was blocked by content moderation (${moderation.categories.join(', ')}). Please rephrase it.` },
        { status: 400 }
      )
    }

    // Verify character belongs to user
    const character = await prisma.character.findUnique({
      where: { id: characterId }
    })

    if (!character || character.userId !== user.userId) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Character not found or does not belong to you' },
        { status: 403 }
      )
    }

    // Verify scene is accepting actions
    const scene = await prisma.scene.findUnique({
      where: { id: sceneId },
      include: { playerActions: true }
    })

    if (!scene || scene.status !== 'AWAITING_ACTIONS') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Scene is not accepting actions' },
        { status: 400 }
      )
    }

    // X-Card pause (see lib/safety/safety-service.ts) blocks new actions
    // until a GM/admin resumes the scene.
    if (scene.isPaused) {
      return NextResponse.json<ErrorResponse>(
        { error: 'This scene is paused for a safety check-in. A GM must resume it before play continues.' },
        { status: 423 }
      )
    }

    // Check if character is already in another active scene
    const otherActiveScenes = await prisma.scene.findMany({
      where: {
        campaignId,
        id: { not: sceneId },
        status: { in: ['AWAITING_ACTIONS', 'RESOLVING'] }
      },
      select: { id: true, sceneNumber: true, participants: true }
    })

    for (const otherScene of otherActiveScenes) {
      const participants = (otherScene.participants as any)?.characterIds || []
      if (participants.includes(characterId)) {
        return NextResponse.json<ErrorResponse>(
          {
            error: `This character is already in another active scene (Scene ${otherScene.sceneNumber})`,
            details: 'A character can only be in one active scene at a time'
          },
          { status: 400 }
        )
      }
    }

    // Add character to scene participants if not already there
    const sceneParticipants = (scene.participants as any) || { characterIds: [], userIds: [] }
    if (!sceneParticipants.characterIds.includes(characterId)) {
      sceneParticipants.characterIds.push(characterId)
      if (!sceneParticipants.userIds.includes(user.userId)) {
        sceneParticipants.userIds.push(user.userId)
      }
      await prisma.scene.update({
        where: { id: sceneId },
        data: { participants: sceneParticipants }
      })
    }

    // Create action - stamp with current exchange number so auto-resolve queries work correctly
    const action = await prisma.playerAction.create({
      data: {
        sceneId,
        characterId,
        userId: user.userId,
        actionText,
        exchangeNumber: scene.currentExchange ?? 0
      },
      include: {
        character: {
          select: {
            id: true,
            name: true
          }
        },
        user: {
          select: {
            id: true,
            email: true
          }
        }
      }
    })

    await recordEvent('ACTION_SUBMITTED', { userId: user.userId, campaignId, metadata: { sceneId } })

    // Update exchange state to track who has acted
    try {
      const { ExchangeManager } = await import('@/lib/game/exchange-manager')
      const exchangeManager = new ExchangeManager(campaignId, sceneId)
      await exchangeManager.recordAction(characterId, action.id)
    } catch (exchangeError) {
      console.error('Failed to record exchange action (non-critical):', exchangeError)
    }

    // Trigger Pusher event to notify all clients
    try {
      await pusherServer.trigger(
        `campaign-${campaignId}`,
        'action:created',
        {
          actionId: action.id,
          sceneId: action.sceneId,
          characterId: action.characterId,
          characterName: action.character.name,
          userId: action.userId,
          actionText: action.actionText,
          timestamp: action.createdAt
        }
      )
    } catch (pusherError) {
      console.error('Failed to trigger Pusher event:', pusherError)
      // Don't fail the request if Pusher fails
    }

    // Check if all participants have submitted - auto-resolve if conditions met
    const hasDefinedParticipants = scene.participants &&
                                   (scene.participants as any).characterIds &&
                                   (scene.participants as any).characterIds.length > 0

    if (hasDefinedParticipants) {
      // Get all actions for this scene's current exchange (not all exchanges)
      const allActions = await prisma.playerAction.findMany({
        where: {
          sceneId,
          exchangeNumber: scene.currentExchange,
          status: 'pending'
        },
        select: { userId: true }
      })

      // Get all unique user IDs from submitted actions
      const submittedUserIds = new Set(allActions.map(a => a.userId))

      const participantUserIds = sceneParticipants.userIds || []

      // Check if all participants have submitted
      const allParticipantsSubmitted = participantUserIds.every((uid: string) =>
        submittedUserIds.has(uid)
      )

      console.log(`📊 Scene ${scene.sceneNumber} participants: ${participantUserIds.length}, submitted: ${submittedUserIds.size}`)

      if (allParticipantsSubmitted && participantUserIds.length > 0) {
        console.log(`🎬 All participants submitted! Enqueueing resolution for scene ${scene.sceneNumber}`)

        // Clear waitingOnUsers so the UI shows everyone has acted,
        // then let the resolver handle status transitions (it sets RESOLVING internally).
        await prisma.scene.update({
          where: { id: sceneId },
          data: { waitingOnUsers: [] }
        })

        // Async resolution: enqueue a ResolutionJob and return. The ~150s
        // AI pipeline runs in the internal worker route's own invocation
        // (maxDuration 300) instead of inside this player's request; the
        // UI follows the existing scene:resolving / scene:resolved /
        // scene:resolution-failed Pusher events exactly as before. Free —
        // billing only happens once, when the scene actually ends.
        try {
          const { enqueueSceneResolution } = await import('@/lib/game/resolutionQueue')
          await enqueueSceneResolution(campaignId, sceneId)
        } catch (error) {
          console.error(`❌ Failed to enqueue resolution for scene ${scene.sceneNumber}:`, error)
          // Don't fail this response — the action itself already saved.
          // Stale-job recovery on scene GET traffic retries from here.
        }
      } else {
        // Update waitingOnUsers to track who hasn't submitted yet
        const stillWaiting = participantUserIds.filter((uid: string) => !submittedUserIds.has(uid))
        await prisma.scene.update({
          where: { id: sceneId },
          data: { waitingOnUsers: stillWaiting }
        })
      }
    } else {
      // For open scenes (no predefined participants), resolve immediately —
      // this is how the GM AI responds to player actions in real time.
      console.log(`🎬 Open scene ${scene.sceneNumber} - enqueueing resolution`)

      // Async resolution — see the participant branch above. The old
      // 2-minute inline timeout/revert dance is gone: job bookkeeping and
      // resolveScene's own status-revert handle every failure mode, and
      // stale jobs are recovered by scene GET traffic. Free — billing
      // only happens once, when the scene actually ends.
      try {
        const { enqueueSceneResolution } = await import('@/lib/game/resolutionQueue')
        await enqueueSceneResolution(campaignId, sceneId)
      } catch (error) {
        console.error(`❌ Failed to enqueue resolution for scene ${scene.sceneNumber}:`, error)
        // Don't fail this response — the action itself already saved.
      }
    }

    return NextResponse.json({ action }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('Submit action error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
