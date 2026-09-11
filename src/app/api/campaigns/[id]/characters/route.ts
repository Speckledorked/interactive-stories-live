// src/app/api/campaigns/[id]/characters/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { validateStats } from '@/lib/game/advancement'
import { isWorldSeeding, SEEDING_MESSAGE } from '@/lib/lore/seedingGate'
import { recordEvent } from '@/lib/analytics/events'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { createCharacter, StartingLoadoutError, type CreateCharacterBody } from '@/lib/game/characterCreation'

/** Request-size ceiling only — the real per-group bound is the world's own
 *  declared slot capacity, enforced in resolveStartingCapabilities. */
const MAX_STARTING_CAPABILITIES = 100

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

    // Membership FIRST, before anything that touches this campaign.
    // isWorldSeeding is not a pure read — it self-heals a stale flag and
    // re-kicks stuck lore jobs (lib/lore/seedingGate.ts), so calling it
    // ahead of the 403 let any authenticated user mutate seeding state on
    // a campaign they don't belong to, and told them from the 409-vs-403
    // whether that campaign existed and was seeding. Every other caller of
    // the gate already authorizes first (start-scene, regenerate-intro,
    // campaigns/[id]); this route was the outlier.
    const membership = await getCampaignMembership(user.userId, campaignId)

    if (!membership) {
      return NextResponse.json(
        { error: 'You are not a member of this campaign' },
        { status: 403 }
      )
    }

    let body: CreateCharacterBody
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Malformed request body' }, { status: 400 })
    }

    if (!body.name) {
      return NextResponse.json(
        { error: 'Character name is required' },
        { status: 400 }
      )
    }

    // The body is client-supplied and only ASSERTED to be CreateCharacterBody.
    // A non-array startingCapabilityIds reached resolveStartingCapabilities'
    // .filter() and threw a TypeError, which the catch below turned into a
    // 500 — a server fault reported for what is purely a bad request.
    if (body.startingCapabilityIds !== undefined) {
      if (
        !Array.isArray(body.startingCapabilityIds) ||
        body.startingCapabilityIds.some((id) => typeof id !== 'string')
      ) {
        return NextResponse.json(
          { error: 'startingCapabilityIds must be an array of capability ids' },
          { status: 400 }
        )
      }
      // A ceiling far above any real loadout (slot capacities run to single
      // digits), purely so an oversized array cannot be turned into a
      // multi-thousand-parameter `IN` query.
      if (body.startingCapabilityIds.length > MAX_STARTING_CAPABILITIES) {
        return NextResponse.json(
          { error: `A starting loadout cannot exceed ${MAX_STARTING_CAPABILITIES} capabilities.` },
          { status: 400 }
        )
      }
    }

    // Play lock: no characters until a creation-time canon import has
    // finished reseeding the world — a character created now would freeze
    // the provisional world in place (see lib/lore/seedingGate.ts).
    if (await isWorldSeeding(campaignId)) {
      return NextResponse.json({ error: SEEDING_MESSAGE, worldSeeding: true }, { status: 409 })
    }

    // Validate stats if provided
    if (body.stats) {
      const validation = validateStats(body.stats as Record<string, number>)
      if (!validation.valid) {
        return NextResponse.json(
          { error: `Invalid stats: ${validation.error}` },
          { status: 400 }
        )
      }
    }

    const character = await createCharacter(campaignId, user.userId, body)

    await recordEvent('CHARACTER_CREATED', { userId: user.userId, campaignId })

    return NextResponse.json({ character })
  } catch (error) {
    // A rejected starting loadout is the player's to fix, not a server
    // fault: too many essences for this world's declared capacity, or a
    // capstone claimed without its foundation. The message says which.
    if (error instanceof StartingLoadoutError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('Create character error:', error)
    return NextResponse.json(
      { error: 'Failed to create character' },
      { status: 500 }
    )
  }
}

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
      return NextResponse.json(
        { error: 'You are not a member of this campaign' },
        { status: 403 }
      )
    }

    const characters = await prisma.character.findMany({
      where: {
        campaignId,
        isAlive: true,
      },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return NextResponse.json({ characters })
  } catch (error) {
    console.error('Get characters error:', error)
    return NextResponse.json(
      { error: 'Failed to get characters' },
      { status: 500 }
    )
  }
}
