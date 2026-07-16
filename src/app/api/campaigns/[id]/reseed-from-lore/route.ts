// src/app/api/campaigns/[id]/reseed-from-lore/route.ts
// Manual trigger for lore-aware world generation. The logic (and the
// fresh-vs-live merge semantics) lives in lib/lore/reseedWorld.ts, shared
// with the automatic creation-time path — campaigns created WITH a lore
// source reseed themselves when the import finishes; this route is the
// re-run / added-lore-later button (Admin → Lore).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { reseedWorldFromLore } from '@/lib/lore/reseedWorld'
import { AI_ACTION_LIMIT, checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'

export const maxDuration = 60

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const membership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId: user.userId, campaignId } },
    })
    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only campaign admins can reseed the world' }, { status: 403 })
    }

    const rateLimit = await checkRateLimit(
      user.userId, AI_ACTION_LIMIT.bucket, AI_ACTION_LIMIT.limit, AI_ACTION_LIMIT.windowSeconds
    )
    if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit)

    const result = await reseedWorldFromLore(campaignId)
    if (!result.ok) {
      if (result.reason === 'not_found') {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
      }
      if (result.reason === 'no_lore') {
        return NextResponse.json(
          { error: 'No imported lore to reseed from — import lore first (Admin → Lore).' },
          { status: 400 }
        )
      }
      return NextResponse.json({ error: 'World generation failed — try again in a moment' }, { status: 502 })
    }

    return NextResponse.json(result.summary)
  } catch (error) {
    console.error('Reseed-from-lore error:', error)
    return NextResponse.json({ error: 'Failed to reseed world from lore' }, { status: 500 })
  }
}
