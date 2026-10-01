// src/app/api/campaigns/[id]/publish/route.ts
//
// #490 — publishing a world to the directory, and unlisting it again.
//
// Admin-only: publishing exposes a world's whole definition, which is the
// work of whoever ran the campaign, not of anyone who happened to play in
// it. Snapshots the DEFINITION only — see lib/worlds/worldSnapshot.ts for
// what is deliberately left out and why.
//
// Republishing an already-published campaign refreshes its snapshot in
// place rather than creating a second entry: a world that has grown since
// it was first shared is the same world, and its slug is already out there
// in links. Forks already taken are unaffected — they copied the snapshot
// at the moment they forked.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import {
  buildWorldSnapshot,
  isPublishable,
  slugifyTitle,
  type SnapshotFaction,
} from '@/lib/worlds/worldSnapshot'
import type { GeneratedCapability, GeneratedFront } from '@/lib/ai/worldGenerator'
import { visibleTo } from '@/lib/api/visibility'

/** How many suffixed slugs to try before giving up on a title. */
const SLUG_ATTEMPTS = 20

/**
 * A free slug for this title. The suffix is short and random rather than a
 * counter: a counter leaks how many worlds share a title, and probing for
 * the next free number is a way to enumerate the directory.
 */
async function reserveSlug(title: string): Promise<string | null> {
  const base = slugifyTitle(title)
  if (!base) return null

  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`
    const taken = await prisma.publishedWorld.findUnique({ where: { slug }, select: { id: true } })
    if (!taken) return slug
  }
  return null
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const campaignId = params.id
    const adminCheck = await requireCampaignAdmin(
      user.userId,
      campaignId,
      'Only campaign admins can publish a world'
    )
    if ('response' in adminCheck) return adminCheck.response

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        title: true,
        description: true,
        universe: true,
        initialWorldSeed: true,
        statLabels: true,
        corruptionTheme: true,
        advancementTrack: true,
        calendarConfig: true,
        worldRules: true,
      },
    })
    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

    // Every related row the definition needs, in one round of reads. NPCs
    // and locations are capped: a long-running campaign accumulates
    // hundreds through play, and a starting world wants the notable ones,
    // not an entire census.
    const [factions, capabilities, clocks, archetypes, moves, npcs, locations] = await Promise.all([
      prisma.faction.findMany({
        where: { campaignId, isActive: true },
        select: { name: true, description: true, goals: true, resources: true, influence: true, threatLevel: true },
        orderBy: { name: 'asc' },
      }),
      prisma.campaignCapability.findMany({
        where: { campaignId },
        select: { domain: true, name: true, description: true, tier: true, isSecret: true },
        orderBy: [{ domain: 'asc' }, { tier: 'asc' }, { name: 'asc' }],
      }),
      // #490: only what a PLAYER in that campaign could already see.
      //
      // Hand-rolling `isHidden: false` here was wrong twice over: a hidden
      // clock is a GM secret, and publishing one hands every forker a
      // spoiler the author never meant to share — but more to the point,
      // clocks gate on isHidden while everything else gates on
      // isDiscovered, which is the OPPOSITE polarity. visibleTo owns that
      // distinction, and the fog guard (api/__tests__/fogOfWar.test.ts)
      // exists because copying it by hand is exactly how it gets inverted.
      //
      // 'PLAYER' rather than the publisher's own role on purpose: the
      // publisher is an admin and would see everything, and the question a
      // snapshot asks is not "what can I see" but "what is this world
      // allowed to show someone who has not played it".
      prisma.clock.findMany({
        where: { campaignId, ...visibleTo('clock', 'PLAYER') },
        select: { name: true, description: true, category: true, maxTicks: true, consequence: true },
        orderBy: { name: 'asc' },
      }),
      prisma.campaignArchetype.findMany({ where: { campaignId }, orderBy: { name: 'asc' } }),
      prisma.move.findMany({ where: { campaignId }, orderBy: { name: 'asc' } }),
      prisma.nPC.findMany({
        where: { campaignId, isAlive: true },
        select: { name: true, description: true, relationship: true, importance: true },
        orderBy: { importance: 'desc' },
        take: 20,
      }),
      prisma.location.findMany({
        where: { campaignId },
        select: { name: true, description: true, locationType: true },
        orderBy: { name: 'asc' },
        take: 20,
      }),
    ])

    const snapshot = buildWorldSnapshot(campaign, {
      factions: factions as SnapshotFaction[],
      capabilities: capabilities as GeneratedCapability[],
      fronts: clocks as unknown as GeneratedFront[],
      archetypes,
      moveFlavor: moves,
      npcs,
      locations,
    })

    // Refused here rather than discovered by the first person to fork it.
    if (!isPublishable(snapshot)) {
      return NextResponse.json(
        {
          error:
            'This world has nothing for someone else to start from yet. Play on a little — once it has factions or a capability tree, it can be published.',
        },
        { status: 400 }
      )
    }

    const existing = await prisma.publishedWorld.findFirst({
      where: { sourceCampaignId: campaignId },
      select: { id: true, slug: true },
    })

    // Republish refreshes in place: the world has grown, but it is the same
    // world and its slug is already in links people have shared.
    if (existing) {
      const updated = await prisma.publishedWorld.update({
        where: { id: existing.id },
        data: {
          title: campaign.title,
          description: campaign.description || '',
          universe: campaign.universe || 'Original',
          snapshot: snapshot as unknown as object,
          isListed: true,
        },
        select: { slug: true, forkCount: true },
      })
      return NextResponse.json({ slug: updated.slug, forkCount: updated.forkCount, republished: true })
    }

    const slug = await reserveSlug(campaign.title)
    if (!slug) {
      return NextResponse.json(
        { error: 'This title cannot be turned into a web address. Try giving the campaign a title with some letters or numbers in it.' },
        { status: 400 }
      )
    }

    const published = await prisma.publishedWorld.create({
      data: {
        slug,
        sourceCampaignId: campaignId,
        publishedBy: user.userId,
        title: campaign.title,
        description: campaign.description || '',
        // The directory's own fallback, matching creation's: a campaign may
        // legitimately have no universe set.
        universe: campaign.universe || 'Original',
        snapshot: snapshot as unknown as object,
      },
      select: { slug: true, forkCount: true },
    })

    return NextResponse.json({ slug: published.slug, forkCount: published.forkCount, republished: false })
  } catch (error) {
    console.error('Publish world error:', error)
    return NextResponse.json({ error: 'Failed to publish world' }, { status: 500 })
  }
}

// DELETE — unlist. Deliberately not a delete: existing forks and shared
// links keep working, and the author can relist by publishing again.
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const adminCheck = await requireCampaignAdmin(
      user.userId,
      params.id,
      'Only campaign admins can unlist a world'
    )
    if ('response' in adminCheck) return adminCheck.response

    await prisma.publishedWorld.updateMany({
      where: { sourceCampaignId: params.id },
      data: { isListed: false },
    })

    return NextResponse.json({ unlisted: true })
  } catch (error) {
    console.error('Unlist world error:', error)
    return NextResponse.json({ error: 'Failed to unlist world' }, { status: 500 })
  }
}

// GET — whether this campaign is published, for the button's state.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const adminCheck = await requireCampaignAdmin(
      user.userId,
      params.id,
      'Only campaign admins can see publishing status'
    )
    if ('response' in adminCheck) return adminCheck.response

    const published = await prisma.publishedWorld.findFirst({
      where: { sourceCampaignId: params.id },
      select: { slug: true, isListed: true, forkCount: true, viewCount: true, updatedAt: true },
    })

    return NextResponse.json({ published })
  } catch (error) {
    console.error('Get publish status error:', error)
    return NextResponse.json({ error: 'Failed to get publishing status' }, { status: 500 })
  }
}
