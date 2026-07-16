// src/app/api/campaigns/[id]/world-extras/route.ts
// Backfill origin archetypes + the corruption theme for an EXISTING
// campaign. New campaigns get these at creation (see campaigns/route.ts);
// campaigns created before that feature existed — or whose generation
// failed — can opt in here from the admin panel instead of being
// permanently locked out. Runs the same generator against the campaign's
// real current factions/capabilities/stat labels.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { generateWorldExtras } from '@/lib/ai/worldExtras'
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
      return NextResponse.json({ error: 'Only campaign admins can generate world extras' }, { status: 403 })
    }

    const rateLimit = await checkRateLimit(
      user.userId, AI_ACTION_LIMIT.bucket, AI_ACTION_LIMIT.limit, AI_ACTION_LIMIT.windowSeconds
    )
    if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit)

    const [campaign, factions, capabilities, existingArchetypes] = await Promise.all([
      prisma.campaign.findUnique({ where: { id: campaignId } }),
      prisma.faction.findMany({
        where: { campaignId, isActive: true },
        select: { name: true, description: true },
      }),
      prisma.campaignCapability.findMany({
        where: { campaignId },
        select: { name: true, description: true, domain: true, tier: true, isSecret: true },
      }),
      prisma.campaignArchetype.count({ where: { campaignId } }),
    ])
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    // Idempotence: this is a backfill, not a re-roll. A campaign that
    // already has both just gets told so — regenerating would silently
    // replace cards players may have already built characters from.
    if (existingArchetypes > 0 && campaign.corruptionTheme) {
      return NextResponse.json({
        error: 'This campaign already has archetypes and a corruption theme.',
      }, { status: 409 })
    }

    const extras = await generateWorldExtras(
      campaign.title,
      campaign.description || '',
      campaign.universe || 'Original',
      factions.map(f => ({ name: f.name, description: f.description || '' })),
      capabilities.map(c => ({
        name: c.name,
        description: c.description || '',
        domain: c.domain,
        tier: c.tier,
        isSecret: c.isSecret,
      })),
      (campaign.statLabels as any) || undefined
    )
    if (!extras) {
      return NextResponse.json({ error: 'Generation failed — try again in a moment' }, { status: 502 })
    }

    let archetypesCreated = 0
    if (existingArchetypes === 0 && extras.archetypes.length > 0) {
      const created = await prisma.campaignArchetype.createMany({
        data: extras.archetypes.map(a => ({
          campaignId,
          name: a.name,
          description: a.description,
          originFamiliarity: a.originFamiliarity,
          suggestedStats: (a.suggestedStats as object | null) || undefined,
          startingGear: (a.startingGear as object | null) || undefined,
          startingTie: (a.startingTie as object | null) || undefined,
          backstoryPrompts: a.backstoryPrompts,
          glimpseCapabilityKeys: a.glimpseCapabilityKeys,
        })),
      })
      archetypesCreated = created.count
    }

    let corruptionThemeSet = false
    if (!campaign.corruptionTheme && extras.corruptionTheme) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { corruptionTheme: extras.corruptionTheme as object },
      })
      corruptionThemeSet = true
    }

    return NextResponse.json({
      archetypesCreated,
      corruptionThemeSet,
      // null from the generator means "this universe has no such concept"
      // — a real answer, distinct from generation failing.
      corruptionThemeName: extras.corruptionTheme?.name ?? null,
    })
  } catch (error) {
    console.error('World extras backfill error:', error)
    return NextResponse.json({ error: 'Failed to generate world extras' }, { status: 500 })
  }
}
