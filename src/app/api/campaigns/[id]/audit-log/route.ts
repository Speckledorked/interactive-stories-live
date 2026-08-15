// src/app/api/campaigns/[id]/audit-log/route.ts
// #289 — StateMutation, LoreCitation, and AIValidationFailure all have real,
// working writers (recordStateMutation in worldUpdaters/characters.ts,
// recordLoreCitations in sceneResolutionRequest.ts, the validation
// degradation path in validation.ts) but no reader anywhere in the app —
// three fully-built audit tables nobody could ever see. This is the read
// side, following the same admin-only bounded-query shape world-events'
// route already established for WorldEvent. Optional `sceneId` filters all
// three at once, since a GM investigating "what happened in this scene" is
// the primary use case for LoreCitation and a real one for the other two.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'

const AUDIT_LOG_ROW_LIMIT = 50

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const { searchParams } = new URL(request.url)
    const sceneId = searchParams.get('sceneId')

    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can view the audit log')
    if ('response' in adminCheck) return adminCheck.response

    const stateMutationWhere: any = { campaignId }
    const loreCitationWhere: any = { campaignId }
    const validationFailureWhere: any = { campaignId }
    if (sceneId) {
      stateMutationWhere.sceneId = sceneId
      loreCitationWhere.sceneId = sceneId
      validationFailureWhere.sceneId = sceneId
    }

    const [stateMutations, loreCitations, validationFailures] = await Promise.all([
      prisma.stateMutation.findMany({
        where: stateMutationWhere,
        orderBy: { createdAt: 'desc' },
        take: AUDIT_LOG_ROW_LIMIT,
      }),
      prisma.loreCitation.findMany({
        where: loreCitationWhere,
        orderBy: { createdAt: 'desc' },
        take: AUDIT_LOG_ROW_LIMIT,
      }),
      prisma.aIValidationFailure.findMany({
        where: validationFailureWhere,
        orderBy: { createdAt: 'desc' },
        take: AUDIT_LOG_ROW_LIMIT,
      }),
    ])

    return NextResponse.json({ stateMutations, loreCitations, validationFailures })
  } catch (error) {
    console.error('Get campaign audit log error:', error)
    return NextResponse.json({ error: 'Failed to get campaign audit log' }, { status: 500 })
  }
}
