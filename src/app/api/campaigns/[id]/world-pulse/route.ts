// src/app/api/campaigns/[id]/world-pulse/route.ts
//
// #523 — what moved while you were in this scene.
//
// There were two surfaces for "what changed" and a gap between them. The
// away letter (#396, /away-recap) windows on the lobby's lastViewedAt, so
// it answers "what did I miss while gone". AITransparencyPanel answers
// "what did my own action just do". Neither covers the ordinary case: you
// have been in a scene for ten minutes, the world took a turn, and three
// things moved that had nothing to do with you.
//
// Almost nothing here is new. The window is the only real decision; the
// selection, the fog pass and the phrasing are loadAbsenceJournal's,
// which is also why this is a route rather than a module — there is no
// logic to put in one.
//
// ── The window ────────────────────────────────────────────────────────────
//
// The current scene's createdAt, not the member's lastViewedAt. Those
// diverge precisely in the case this exists for: a player sitting in a
// scene is not viewing the lobby, so lastViewedAt is stale and the away
// letter would either repeat itself or say nothing. Anchoring to the scene
// makes the question exactly "since I sat down".
//
// No active scene means no pulse — an empty answer rather than a fallback
// to the absence window, because that window already has a surface and
// answering the same question twice in two voices is what #396's own
// comment warns about ("rendering it twice would be two views of one thing
// rather than two things").

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { loadAbsenceJournal } from '@/lib/game/absenceJournalQuery'
// MAX_PULSE_ENTRIES is NOT exported from here: a route.ts may only export
// the names Next.js reserves, and exporting it failed `next build`.
import {
  describeJournalEntry,
  CATEGORY_LABELS,
  MAX_PULSE_ENTRIES,
} from '@/lib/game/absenceJournal'

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

    // Same lifecycle predicate the scene route uses — a scene is live
    // while it is awaiting actions or resolving.
    const scene = await prisma.scene.findFirst({
      where: { campaignId, status: { in: ['AWAITING_ACTIONS', 'RESOLVING'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true },
    })

    if (!scene) {
      return NextResponse.json({ sceneId: null, entries: [], totalEvents: 0 })
    }

    const journal = await loadAbsenceJournal(
      campaignId,
      scene.createdAt,
      membership.role,
      MAX_PULSE_ENTRIES
    )

    return NextResponse.json({
      sceneId: scene.id,
      // Shaped exactly as /away-recap shapes it: rendered lines and a
      // category label, never the raw JournalEntry. Those fields carry
      // targetId and field names, and a client that receives them is a
      // client that can render them.
      entries: journal.entries.map((entry) => ({
        id: entry.id,
        category: entry.category,
        categoryLabel: CATEGORY_LABELS[entry.category],
        // Never entry.reason — that text is GM-grade, and the journal
        // never selects it in the first place.
        line: describeJournalEntry(entry),
      })),
      // The real count over the window, which can exceed what is shown —
      // loadAbsenceJournal measures it with an aggregate rather than
      // inferring it from the sample (#445).
      totalEvents: journal.totalEvents,
    })
  } catch (error) {
    console.error('Get world pulse error:', error)
    return NextResponse.json({ error: 'Failed to read the world' }, { status: 500 })
  }
}
