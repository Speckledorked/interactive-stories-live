// src/lib/game/actionSubmission.ts
// The business logic behind POST /api/campaigns/[id]/scene, moved out of
// the route handler: once a submission has passed every validation gate
// (auth, rate limit, moderation, character ownership/harm, scene status,
// X-Card pause, cross-scene conflict, scoped-participant enforcement —
// all of which stay in the route since they're guard clauses over the
// request, not state-mutating work), this owns adding the character to
// the scene's participant list (with its optimistic-concurrency retry),
// creating the PlayerAction row, the exchange-tracking/Pusher side
// effects, and deciding whether the whole party has now acted — and if
// so, enqueueing resolution instead of just updating who's still waited on.

import { prisma } from '@/lib/prisma'
import type { Scene } from '@prisma/client'
import { pusherServer } from '@/lib/pusher'
import { recordEvent } from '@/lib/analytics/events'

export interface SceneParticipants {
  characterIds: string[]
  userIds: string[]
  scoped: boolean
}

export async function submitPlayerAction(
  campaignId: string,
  userId: string,
  characterId: string,
  actionText: string,
  scene: Scene,
  initialSceneParticipants: SceneParticipants
) {
  const sceneId = scene.id
  let sceneParticipants = initialSceneParticipants

  // Add character to scene participants if not already there (open
  // scenes only — a closed scene's membership was just enforced by the
  // route's scoped check before this was called). Retried with
  // optimistic concurrency (guarded on updatedAt): two players joining
  // the same open scene for the first time within the same instant would
  // otherwise race this read-modify-write, and whichever write landed
  // second would silently drop the other player's characterId/userId from
  // participants — which then made that player invisible to the "has
  // everyone acted" check below, exactly the scenario that let a scene
  // auto-resolve on only one of two already-submitted actions (see the
  // matching fix in ExchangeManager.recordAction).
  if (!sceneParticipants.characterIds.includes(characterId)) {
    const MAX_PARTICIPANT_ATTEMPTS = 5
    for (let attempt = 0; attempt < MAX_PARTICIPANT_ATTEMPTS; attempt++) {
      const liveScene = attempt === 0 ? scene : await prisma.scene.findUnique({ where: { id: sceneId } })
      if (!liveScene) break

      const liveParticipants = (liveScene.participants as any) || { characterIds: [], userIds: [], scoped: false }
      if (!liveParticipants.characterIds.includes(characterId)) {
        liveParticipants.characterIds.push(characterId)
      }
      if (!liveParticipants.userIds.includes(userId)) {
        liveParticipants.userIds.push(userId)
      }

      const result = await prisma.scene.updateMany({
        where: { id: sceneId, updatedAt: liveScene.updatedAt },
        data: { participants: liveParticipants }
      })

      if (result.count > 0) {
        sceneParticipants = liveParticipants
        break
      }
      // Lost the race — someone else updated the scene since liveScene
      // was read. Retry against the fresh row.
    }
  }

  // Create action - stamp with current exchange number so auto-resolve queries work correctly
  const action = await prisma.playerAction.create({
    data: {
      sceneId,
      characterId,
      userId,
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

  await recordEvent('ACTION_SUBMITTED', { userId, campaignId, metadata: { sceneId } })

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

  // Who needs to act before this exchange can resolve. A defined-
  // participant scene (Character-Focused/split-party, scoped: true) has
  // its own explicit roster; an open scene doesn't, so it's every living
  // character in the campaign instead — an open scene is meant to
  // include the whole party, so resolution shouldn't fire the instant
  // the first person acts, only once everyone actually has. Gating on
  // `characterIds.length > 0` alone used to flip this the moment an open
  // scene's first player joined it: participantUserIds would then
  // silently narrow to just whoever had joined so far instead of the
  // full living roster, so a scene could resolve without ever waiting
  // for a character who simply hadn't acted yet this scene.
  const hasDefinedParticipants = sceneParticipants.scoped === true

  let participantUserIds: string[]
  if (hasDefinedParticipants) {
    participantUserIds = sceneParticipants.userIds || []
  } else {
    const livingCharacters = await prisma.character.findMany({
      where: { campaignId, isAlive: true },
      select: { userId: true }
    })
    participantUserIds = [...new Set(livingCharacters.map(c => c.userId))]
  }

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

  // Check if all participants have submitted
  const allParticipantsSubmitted = participantUserIds.length > 0 &&
    participantUserIds.every((uid: string) => submittedUserIds.has(uid))

  console.log(`📊 Scene ${scene.sceneNumber} party: ${participantUserIds.length}, submitted: ${submittedUserIds.size}`)

  if (allParticipantsSubmitted) {
    console.log(`🎬 Whole party submitted! Enqueueing resolution for scene ${scene.sceneNumber}`)

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

  return action
}
