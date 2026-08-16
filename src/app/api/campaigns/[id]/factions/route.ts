// src/app/api/campaigns/[id]/factions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { isUniqueConstraintViolation } from '@/lib/game/worldUpdaters/uniqueConstraintGuard'
import { prisma } from '@/lib/prisma'
import { visibleTo, isCampaignAdmin } from '@/lib/api/visibility'
import { getUser } from '@/lib/auth'
import { redactGmNotesList } from '@/lib/game/visibility'
import { getCampaignMembership, requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { TIE_INCLUDE, factionTies } from '@/lib/game/tieGraph'

// GET /api/campaigns/:id/factions - List all factions for a campaign
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

    // Check if user is a member
    const membership = await getCampaignMembership(user.userId, campaignId)

    if (!membership) {
      return NextResponse.json(
        { error: 'Not a member of this campaign' },
        { status: 403 }
      )
    }

    const isAdmin = isCampaignAdmin(membership.role)

    // Fog of war: admins see undiscovered factions too (they manage them);
    // everyone else sees only what the party has actually found.
    const factions = await prisma.faction.findMany({
      where: { campaignId, ...visibleTo('faction', membership.role) },
      orderBy: { createdAt: 'desc' },
      include: TIE_INCLUDE,
    })

    // #373: ties are edges now. The response keeps the `relationships`
    // shape the admin faction map already renders — that map wants "who
    // does this faction know", which is exactly the per-node projection —
    // while the raw edge rows stay off the wire.
    const withTies = factions.map(({ tiesAsA: _a, tiesAsB: _b, ...faction }) => ({
      ...faction,
      relationships: factionTies({ id: faction.id, tiesAsA: _a, tiesAsB: _b }),
    }))

    return NextResponse.json({ factions: redactGmNotesList(withTies, isAdmin) })
  } catch (error) {
    console.error('Get factions error:', error)
    return NextResponse.json(
      { error: 'Failed to get factions' },
      { status: 500 }
    )
  }
}

// POST /api/campaigns/:id/factions - Create a new faction
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
    const body = await request.json()

    // Check if user is admin
    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can create factions')
    if ('response' in adminCheck) return adminCheck.response

    // Validate required fields
    if (!body.name) {
      return NextResponse.json(
        { error: 'Faction name is required' },
        { status: 400 }
      )
    }

    // #400: guarded like every other creator of a name-unique model.
    // Phase 1b gave Faction.name a real case-insensitive DB constraint, and
    // this route checks nothing before creating — so an admin adding a
    // faction while the AI mints one with the same name mid-scene got a
    // raw 500. This guard was previously enforced only across a hardcoded
    // seven-file allowlist, and this route was file #8.
    let faction
    try {
      faction = await prisma.faction.create({
      data: {
        campaignId,
        name: body.name,
        description: body.description || null,
        goals: body.goals || null,
        goal: body.goal || undefined,
        archetype: body.archetype || undefined,
        resources: body.resources !== undefined ? body.resources : 50,
        influence: body.influence !== undefined ? body.influence : 50,
        currentPlan: body.currentPlan || null,
        threatLevel: body.threatLevel || 1,
        // #373: `relationships: body.relationships` used to sit here — a
        // raw JSON passthrough no client ever sent, and one of the "any
        // other path can write a legal-looking asymmetric map" holes the
        // symmetry integrity check existed to catch. Ties are formed by
        // relationshipTick from goals and stability; there is no
        // hand-authored version of them to accept.
        gmNotes: body.gmNotes || null,
        leaderCharacterId: body.leaderCharacterId || null,
        isDiscovered: body.isDiscovered !== undefined ? body.isDiscovered : true,
        },
      })
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error
      return NextResponse.json({ error: 'A faction with that name already exists' }, { status: 409 })
    }

    return NextResponse.json({ faction }, { status: 201 })
  } catch (error) {
    console.error('Create faction error:', error)
    return NextResponse.json(
      { error: 'Failed to create faction' },
      { status: 500 }
    )
  }
}
