// src/app/api/campaigns/[id]/scene/route.ts
// Scene management
// GET - Get current scene
// POST - Submit player action

import { NextRequest, NextResponse } from 'next/server'
import { validateActionText } from '@/lib/ai/playerText'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { SubmitActionRequest, ErrorResponse } from '@/types/api'
import { AI_ACTION_LIMIT, checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { moderatePlayerText } from '@/lib/ai/moderation'
import { canAct, parseHarmState, HarmLevel } from '@/lib/game/harm'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { handleRouteError } from '@/lib/api/errors'
import { submitPlayerAction, type SceneParticipants } from '@/lib/game/actionSubmission'

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
    const user = await requireAuth(request)
    const campaignId = params.id

    // Check membership
    const membership = await getCampaignMembership(user.userId, campaignId)

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

    // #291: same opportunistic recovery for async map-generation jobs.
    try {
      const { recoverStaleMapJobs } = await import('@/lib/game/mapGenQueue')
      await recoverStaleMapJobs(campaignId)
    } catch (recoveryError) {
      console.error('Stale map job recovery failed (non-critical):', recoveryError)
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
              select: { id: true, email: true, name: true }
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

    // SceneImage.sceneId is a plain indexed string, not a Prisma relation
    // (see its schema comment — deliberately no FK), so it can't ride
    // along in the `include` above; fetched separately and attached here
    // so the story page knows whether a scene already has (or failed to
    // get) an illustration on initial load, not just via the
    // scene:image-ready Pusher event fired after a fresh generation
    // completes.
    let scenesWithImages = activeScenes
    if (activeScenes.length > 0) {
      try {
        const images = await prisma.sceneImage.findMany({
          where: { sceneId: { in: activeScenes.map(s => s.id) } },
          select: { sceneId: true, status: true, imageUrl: true },
        })
        const imagesBySceneId = new Map(images.map(img => [img.sceneId, img]))
        scenesWithImages = activeScenes.map(scene => ({
          ...scene,
          sceneImage: imagesBySceneId.get(scene.id) ?? null,
        }))
      } catch (imageLookupError) {
        console.error('Scene image lookup failed (non-critical):', imageLookupError)
      }
    }

    // For backwards compatibility, also return the first scene as "scene"
    const currentScene = scenesWithImages.length > 0 ? scenesWithImages[0] : null

    return NextResponse.json({ scene: currentScene, scenes: scenesWithImages })
  } catch (error) {
    return handleRouteError(error, 'Get scene error', 'Internal server error')
  }
}

// POST - Submit action for current scene
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(request)
    const campaignId = params.id
    const body: SubmitActionRequest = await request.json()

    const { sceneId, characterId, actionText: rawActionText } = body

    // Validate input
    if (!sceneId || !characterId) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Scene ID, character ID, and action text are required' },
        { status: 400 }
      )
    }

    // #382: player text is untrusted input to an interpreter (the model)
    // that then emits privileged state changes. This checked only that the
    // string was non-empty — no length cap at all, so one request could
    // fill the model's context window on a paid endpoint, and no
    // sanitisation, so the text reached both prompts verbatim.
    //
    // Rejected rather than truncated: silently cutting an action in half
    // changes what the player asked for. The fencing itself lives in
    // lib/ai/playerText.ts and is applied at both prompt builders.
    const validated = validateActionText(rawActionText)
    if (!validated.ok) {
      return NextResponse.json<ErrorResponse>({ error: validated.error }, { status: 400 })
    }
    const actionText = validated.text

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
    if (moderation.unavailable) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Safety check unavailable right now — please try again in a moment.' },
        { status: 503 }
      )
    }
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

    // A character at harm 6 (Taken Out) or under an incapacitating
    // condition ("Cannot act"/"Cannot take actions") can't submit actions
    // until stabilized/healed/cleared.
    const characterConditions = parseHarmState(character.conditions).conditions
    if (!canAct(character.harm as HarmLevel, characterConditions)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'This character cannot act right now (Taken Out or incapacitated) and cannot submit actions until stabilized.' },
        { status: 409 }
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
        { error: 'This scene is paused for a safety check-in. The campaign host must resume it before play continues.' },
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

    // Enforce the scene's explicit participant list, if it was scoped to
    // specific characters at creation (a Character-Focused or split-party
    // scene — see start-scene/route.ts; any player can start one).
    // scene.participants is null for a genuinely open scene, where the
    // dynamic "add as they act" behavior below is correct and intended;
    // only a scene created WITH an explicit characterIds list (scoped:
    // true — see createNewScene) is closed to anyone else. Gating on
    // `characterIds.length > 0` alone used to reject this: an open
    // scene's participants also ends up as a non-empty {characterIds,
    // userIds} object the moment its first player acts, which made the
    // scene look "closed" to every other character from then on — they'd
    // get 403'd here, see no active scene of their own, and spin up a
    // brand-new disconnected one, splitting the party into two
    // independent stories neither could see the other's.
    const sceneParticipants: SceneParticipants = (scene.participants as any) || { characterIds: [], userIds: [], scoped: false }
    if (sceneParticipants.scoped && !sceneParticipants.characterIds.includes(characterId)) {
      return NextResponse.json<ErrorResponse>(
        {
          error: 'This character is not part of this scene',
          details: 'This scene was started for specific characters only.'
        },
        { status: 403 }
      )
    }

    const action = await submitPlayerAction(campaignId, user.userId, characterId, actionText, scene, sceneParticipants)

    return NextResponse.json({ action }, { status: 201 })
  } catch (error) {
    return handleRouteError(error, 'Submit action error', 'Internal server error')
  }
}
