// src/app/api/public/worlds/route.ts
//
// #490 — the world directory. Public and unauthenticated, like the
// chronicle share pages next door: the point is that a stranger can see
// what people have built here before being asked to sign up for anything.
//
// Returns the card, never the snapshot. A world's full definition is what
// forking gives you, and shipping every snapshot in a list response would
// make the directory enormous and hand the whole catalogue to a scraper in
// one request.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const PAGE_SIZE = 24
const MAX_PAGE_SIZE = 48

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    const rawLimit = parseInt(searchParams.get('limit') || '', 10)
    const limit = Number.isInteger(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_SIZE)
      : PAGE_SIZE

    const rawOffset = parseInt(searchParams.get('offset') || '', 10)
    const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0

    const search = (searchParams.get('q') || '').trim().slice(0, 100)

    const where = {
      isListed: true,
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' as const } },
              { universe: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }

    const [worlds, total] = await Promise.all([
      prisma.publishedWorld.findMany({
        where,
        // Most-forked first: the only signal available that is about
        // whether people actually started something here, rather than
        // about how recently somebody pressed publish. Ratings would be a
        // better signal and are deliberately not built — see the schema
        // comment on PublishedWorld.
        orderBy: [{ forkCount: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        skip: offset,
        select: {
          slug: true,
          title: true,
          description: true,
          universe: true,
          forkCount: true,
          createdAt: true,
          publisher: { select: { name: true } },
        },
      }),
      prisma.publishedWorld.count({ where }),
    ])

    return NextResponse.json({
      worlds: worlds.map((w) => ({
        slug: w.slug,
        title: w.title,
        description: w.description,
        universe: w.universe,
        forkCount: w.forkCount,
        createdAt: w.createdAt,
        // Display name only, never the email: this response is public, and
        // an email here would publish the address of everyone who shared a
        // world.
        author: w.publisher.name || 'Anonymous',
      })),
      total,
      hasMore: offset + worlds.length < total,
    })
  } catch (error) {
    console.error('List worlds error:', error)
    return NextResponse.json({ error: 'Failed to list worlds' }, { status: 500 })
  }
}
