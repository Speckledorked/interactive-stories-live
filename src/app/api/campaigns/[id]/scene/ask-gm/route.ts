// src/app/api/campaigns/[id]/scene/ask-gm/route.ts
// "Ask the GM" — an out-of-character clarifying question about the current
// scene, deliberately kept OUTSIDE the action-resolution pipeline: no
// PlayerAction row, no dice, no exchange consumption, no world_updates.
// See prisma/schema.prisma's GmClarification doc and lib/ai/askGm.ts.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { pusherServer } from '@/lib/pusher'
import { AI_ACTION_LIMIT, checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { moderatePlayerText } from '@/lib/ai/moderation'
import { answerGmQuestion, MAX_QUESTION_CHARS } from '@/lib/ai/askGm'

export const maxDuration = 30

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id
    const body = await request.json()
    const { sceneId, characterId, question } = body

    if (!sceneId || !characterId || typeof question !== 'string' || !question.trim()) {
      return NextResponse.json({ error: 'Scene ID, character ID, and a question are required' }, { status: 400 })
    }
    const trimmedQuestion = question.trim().slice(0, MAX_QUESTION_CHARS)

    // Same shared AI-action budget as submitting a real action — this still
    // calls the model, just a smaller/cheaper call.
    const rateLimit = await checkRateLimit(user.userId, AI_ACTION_LIMIT.bucket, AI_ACTION_LIMIT.limit, AI_ACTION_LIMIT.windowSeconds)
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { title: true, universe: true, contentModerationLevel: true },
    })
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const moderationLevel = campaign.contentModerationLevel === 'strict' ? 'strict' : 'standard'
    const moderation = await moderatePlayerText(trimmedQuestion, moderationLevel)
    if (moderation.flagged) {
      return NextResponse.json(
        { error: `Your question was blocked by content moderation (${moderation.categories.join(', ')}). Please rephrase it.` },
        { status: 400 }
      )
    }

    const character = await prisma.character.findUnique({ where: { id: characterId } })
    if (!character || character.userId !== user.userId) {
      return NextResponse.json({ error: 'Character not found or does not belong to you' }, { status: 403 })
    }

    const scene = await prisma.scene.findUnique({ where: { id: sceneId } })
    if (!scene || scene.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 })
    }
    // Asking mid-resolution risks grounding the answer in a state that's
    // about to change out from under it — keep this simple and safe.
    if (scene.status !== 'AWAITING_ACTIONS') {
      return NextResponse.json({ error: 'The GM is mid-resolution — try again in a moment' }, { status: 400 })
    }

    const sceneText = [scene.sceneIntroText, scene.sceneResolutionText].filter(Boolean).join('\n\n')

    const answer = await answerGmQuestion(campaignId, {
      campaignTitle: campaign.title,
      universe: campaign.universe || 'Original',
      characterId: character.id,
      characterName: character.name,
      sceneText,
      question: trimmedQuestion,
    })

    if (!answer) {
      return NextResponse.json({ error: 'The GM couldn\'t answer that just now — try again in a moment' }, { status: 502 })
    }

    const clarification = await prisma.gmClarification.create({
      data: {
        campaignId,
        sceneId,
        characterId: character.id,
        userId: user.userId,
        question: trimmedQuestion,
        answer,
      },
      include: { character: { select: { id: true, name: true } } },
    })

    // Broadcast so the whole party sees the clarification live — the same
    // "said out loud at the table" visibility a real question would have.
    try {
      await pusherServer.trigger(`campaign-${campaignId}`, 'gm:clarification', {
        id: clarification.id,
        sceneId,
        characterId: clarification.characterId,
        characterName: clarification.character.name,
        question: clarification.question,
        answer: clarification.answer,
        createdAt: clarification.createdAt,
      })
    } catch (pusherError) {
      console.error('Failed to trigger Pusher event (non-critical):', pusherError)
    }

    return NextResponse.json({ clarification })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Ask-GM error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
