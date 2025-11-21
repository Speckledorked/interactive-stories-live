// PLACE IN: src/app/api/campaigns/[id]/scenes/[sceneId]/resolve-visual/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { AISceneVisualIntegration } from '@/lib/ai/ai-scene-visual-integration'
import { z } from 'zod'

const resolveSceneSchema = z.object({
  playerActions: z.array(z.object({
    playerId: z.string(),
    action: z.string().min(1, 'Action cannot be empty'),
    characterId: z.string().optional()
  }))
})

// POST /api/campaigns/[id]/scenes/[sceneId]/resolve-visual
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; sceneId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const sceneId = params.sceneId
    const body = await request.json()
    
    // Validate input
    const { playerActions } = resolveSceneSchema.parse(body)

    // Resolve scene with automatic visual generation
    const result = await AISceneVisualIntegration.resolveSceneWithVisuals(
      sceneId,
      playerActions,
      campaignId
    )

    return NextResponse.json({
      success: true,
      sceneResolution: result.description,
      visualData: result.visualData,
      mapId: result.mapId,
      message: 'Scene resolved with AI-generated visuals'
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error resolving scene with visuals:', error)
    return NextResponse.json(
      { error: 'Failed to resolve scene with visuals' },
      { status: 500 }
    )
  }
}
