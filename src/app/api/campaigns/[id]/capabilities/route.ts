// src/app/api/campaigns/[id]/capabilities/route.ts
// The campaign's visible capability scaffold, for the character creation
// wizard's starting-loadout picker — readable by any campaign member.
//
// Visibility is the SAME surface glimpse seeding exposes (see
// decideSeedStates and the archetype-glimpse path in characterCreation.ts):
// non-secret, non-shadow nodes only. A secret branch a player cannot start
// with must not appear in a list of things they cannot pick — the refusal
// itself would leak that the branch exists, which is the fog-of-war rule
// this repo applies everywhere (#94: gate the response, don't strip fields).
//
// Prerequisite ids ship so the wizard can enforce the #372 DAG closure
// client-side as a courtesy; resolveStartingCapabilities re-validates
// server-side regardless. Ids of secret prerequisites are NOT filtered out
// of the edge list — a visible node whose prerequisite is secret is simply
// unpickable until the fiction reveals the chain, and the server check
// yields the honest error either way.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'

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
    const membership = await getCampaignMembership(user.userId, campaignId)
    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const capabilities = await prisma.campaignCapability.findMany({
      where: { campaignId, isSecret: false, isShadow: false },
      select: {
        id: true,
        key: true,
        name: true,
        domain: true,
        tier: true,
        description: true,
        prerequisites: { select: { prerequisiteCapabilityId: true } },
      },
      orderBy: [{ domain: 'asc' }, { tier: 'asc' }, { name: 'asc' }],
    })

    return NextResponse.json({
      capabilities: capabilities.map((c) => ({
        id: c.id,
        key: c.key,
        name: c.name,
        domain: c.domain,
        tier: c.tier,
        description: c.description,
        prerequisiteIds: c.prerequisites.map((p) => p.prerequisiteCapabilityId),
      })),
    })
  } catch (error) {
    console.error('Get capabilities error:', error)
    return NextResponse.json({ error: 'Failed to get capabilities' }, { status: 500 })
  }
}
