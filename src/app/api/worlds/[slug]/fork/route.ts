// src/app/api/worlds/[slug]/fork/route.ts
//
// #490 — one click from reading about a world to playing in it.
//
// This is the whole point of the directory. It creates a campaign from the
// published snapshot, SYNCHRONOUSLY, and that is not an inconsistency with
// #493 making ordinary creation a background job: ordinary creation is slow
// because of five model calls, and a fork makes none. The world has already
// been generated, once, by whoever published it. All that is left is the
// seeding transaction, which is fast enough to answer in the request — and
// answering in the request is what makes it one click instead of a modal
// that follows a job.
//
// The fork is the forker's own campaign from the first moment: their
// membership, their ADMIN role, their copy. Nothing links back to the
// original except the counter, and no later change to the published world
// reaches a fork already taken.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { recordEvent } from '@/lib/analytics/events'
import { createCampaign } from '@/lib/game/campaignCreation'
import { snapshotToPreGenerated } from '@/lib/worlds/worldSnapshot'

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const user = await getUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const world = await prisma.publishedWorld.findUnique({
      where: { slug: params.slug },
      select: { id: true, title: true, description: true, universe: true, snapshot: true },
    })
    if (!world) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Null means a snapshot this build cannot honour — a future version, or
    // a malformed row. Refused plainly rather than guessed at: seeding a
    // world from fields that were misread produces a broken campaign the
    // forker then has to work out for themselves.
    const preGenerated = snapshotToPreGenerated(world.snapshot)
    if (!preGenerated) {
      return NextResponse.json(
        { error: 'This world was published by a newer version of MythOS and cannot be copied here yet.' },
        { status: 409 }
      )
    }

    // An optional title, so forking the same world twice does not leave two
    // identically named campaigns in the forker's list.
    const body = await request.json().catch(() => ({}))
    const requestedTitle = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : ''

    const campaign = await createCampaign({
      title: requestedTitle || world.title,
      description: world.description,
      // The published premise is the starting point. Passed as the seed so
      // it is not overwritten by a generation that is not going to run.
      initialWorldSeed: preGenerated.worldSeed,
      resolvedUniverse: world.universe,
      // Deliberately the generic default rather than the original's prompt:
      // aiSystemPrompt is the author's own GM direction for their table, and
      // is not part of the setting the way factions and a calendar are.
      resolvedSystemPrompt: '',
      template: null,
      validatedLore: null,
      userId: user.userId,
      preGenerated,
    })

    // Counted after the campaign exists, so the number means "worlds
    // actually started from this", not "times someone pressed the button".
    // Best-effort: a counter is not worth failing a successful fork over.
    await prisma.publishedWorld
      .update({ where: { id: world.id }, data: { forkCount: { increment: 1 } } })
      .catch((err) => console.error('Fork count failed (non-critical):', err))

    await recordEvent('CAMPAIGN_CREATED', { userId: user.userId, campaignId: campaign.id })

    return NextResponse.json({ campaignId: campaign.id }, { status: 201 })
  } catch (error) {
    console.error('Fork world error:', error)
    return NextResponse.json({ error: 'Failed to start from this world' }, { status: 500 })
  }
}
