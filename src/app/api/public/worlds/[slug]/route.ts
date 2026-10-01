// src/app/api/public/worlds/[slug]/route.ts
//
// #490 — one world's page, for someone deciding whether to start from it.
//
// Public and unauthenticated. Returns a SUMMARY of the snapshot — how many
// factions, their names, the capability domains, the premise — never the
// snapshot itself. What is in a world is worth knowing before you fork it;
// the full definition is what forking is for, and handing it over here
// would make the fork counter meaningless and the directory trivially
// copyable.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { WorldSnapshot } from '@/lib/worlds/worldSnapshot'

/** Names shown on the page. Enough to judge a world, not enough to rebuild it. */
const PREVIEW_FACTIONS = 6
const PREVIEW_DOMAINS = 8

export async function GET(_request: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const world = await prisma.publishedWorld.findUnique({
      where: { slug: params.slug },
      select: {
        slug: true,
        title: true,
        description: true,
        universe: true,
        snapshot: true,
        forkCount: true,
        isListed: true,
        createdAt: true,
        publisher: { select: { name: true } },
      },
    })

    // An unlisted world stays reachable by its direct link — that is the
    // difference between unlisting and deleting, and it is what keeps
    // already-shared links working.
    if (!world) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const snapshot = world.snapshot as unknown as Partial<WorldSnapshot>
    const factions = Array.isArray(snapshot?.factions) ? snapshot.factions : []
    const capabilities = Array.isArray(snapshot?.capabilities) ? snapshot.capabilities : []
    const domains = [...new Set(capabilities.map((c) => c?.domain).filter(Boolean))]

    // Best-effort and deliberately not awaited into the response shape: a
    // view counter is not worth failing a page load over. Awaited rather
    // than detached, because a serverless invocation can freeze the moment
    // it returns.
    await prisma.publishedWorld
      .update({ where: { slug: params.slug }, data: { viewCount: { increment: 1 } } })
      .catch((err) => console.error('World view count failed (non-critical):', err))

    return NextResponse.json({
      world: {
        slug: world.slug,
        title: world.title,
        description: world.description,
        universe: world.universe,
        forkCount: world.forkCount,
        isListed: world.isListed,
        createdAt: world.createdAt,
        author: world.publisher.name || 'Anonymous',
        premise: typeof snapshot?.worldSeed === 'string' ? snapshot.worldSeed : '',
        factionCount: factions.length,
        factionNames: factions.slice(0, PREVIEW_FACTIONS).map((f) => f?.name).filter(Boolean),
        capabilityCount: capabilities.length,
        capabilityDomains: domains.slice(0, PREVIEW_DOMAINS),
      },
    })
  } catch (error) {
    console.error('Get world error:', error)
    return NextResponse.json({ error: 'Failed to get world' }, { status: 500 })
  }
}
