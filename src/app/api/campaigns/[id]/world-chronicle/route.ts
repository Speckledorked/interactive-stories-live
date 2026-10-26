// src/app/api/campaigns/[id]/world-chronicle/route.ts
//
// #522 — the whole history of the world moving on its own, browsable.
//
// NOT a relaxed gate on ../world-events. That route is admin-only for a
// stated reason, and the reason is one field:
//
//   "reason strings can reference GM-only state (a hidden faction's
//    scheme, an undiscovered NPC's plan) the same way gmNotes can"
//
// So this is a separate projection that does not select `reason` at all.
// Not truncated, not sanitised — absent from the query, so no future
// serializer change can put it back on the wire by accident.
//
// ── What this adds that #396 did not ──────────────────────────────────────
//
// #396 already made WorldEvent the durable player-facing record and reads
// it through /away-recap, so "players cannot see the simulation" was
// already false. But that read is bounded to the absence window
// (createdAt > lastViewedAt), coverage-first selected, and capped at
// MAX_JOURNAL_ENTRIES (12) from a JOURNAL_SCAN_LIMIT (400) sample. It
// answers "what did I miss". Nothing answered "show me everything, let me
// page back", which is what a chronicle is.
//
// Everything hard is borrowed rather than rebuilt: the vocabulary is
// worldEventPhrasing.ts (shared with the journal since 9db8c49), and the
// fog rule is worldEventFog.ts reading world-digest.ts's own table.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { buildWorldEventFog } from '@/lib/api/worldEventFog'
import { phraseWorldEvent } from '@/lib/game/worldEventPhrasing'
// Not exported from this file: a route.ts may only export the names Next.js
// reserves, and exporting these here failed `next build`. See the module.
import { CHRONICLE_PAGE_SIZE, CHRONICLE_SCAN } from '@/lib/game/worldChronicle'


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

    const { searchParams } = new URL(request.url)
    const cursor = searchParams.get('cursor')

    const [isVisible, rows] = await Promise.all([
      buildWorldEventFog(campaignId, membership.role),
      prisma.worldEvent.findMany({
        where: {
          campaignId,
          // The same gate CampaignMemory and WikiEntry already use (see
          // tick/worldEventLog.ts). #396's own finding is the argument for
          // it: the categories that produce the most rows — weather, NPC
          // plans — crowd out the ones that matter. A chronicle flooded
          // with routine weather is not a browsable history, it is a log.
          significant: true,
        },
        // Matches the admin route's ordering, with id as the tiebreak that
        // makes cursor paging total: turn numbers can freeze (#374), so
        // turnNumber alone leaves rows tied and a cursor ambiguous.
        orderBy: [{ turnNumber: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: CHRONICLE_SCAN,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          turnNumber: true,
          createdAt: true,
          type: true,
          targetType: true,
          targetId: true,
          targetName: true,
          previousValue: true,
          newValue: true,
          importance: true,
          // `reason` is deliberately absent — see the module comment.
        },
      }),
    ])

    const entries = []
    // The id of the last row CONSIDERED, not the last one kept: paging
    // from a kept row would re-read everything dropped after it forever.
    let lastScannedId: string | null = null
    let scanned = 0

    for (const row of rows) {
      lastScannedId = row.id
      scanned += 1
      if (!isVisible({ targetType: row.targetType, targetId: row.targetId })) continue
      const phrased = phraseWorldEvent({
        type: row.type,
        targetName: row.targetName,
        previousValue: row.previousValue,
        newValue: row.newValue,
      })
      if (!phrased) continue

      entries.push({
        id: row.id,
        turnNumber: row.turnNumber,
        at: row.createdAt,
        text: phrased.text,
        kind: phrased.kind,
        major: row.importance === 'MAJOR',
      })
      if (entries.length >= CHRONICLE_PAGE_SIZE) break
    }

    // Two independent reasons there is more. Breaking out at the page size
    // leaves scanned-but-unconsumed rows whatever the scan's own length
    // was, and a full scan means the table itself may hold more. Checking
    // only the second would have ended history early on any page that
    // filled before the scan ran out.
    const hasMore = scanned < rows.length || rows.length === CHRONICLE_SCAN

    return NextResponse.json({
      entries,
      nextCursor: hasMore ? lastScannedId : null,
    })
  } catch (error) {
    console.error('Get world chronicle error:', error)
    return NextResponse.json({ error: 'Failed to load the chronicle' }, { status: 500 })
  }
}
