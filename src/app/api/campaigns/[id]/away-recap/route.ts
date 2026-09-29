// src/app/api/campaigns/[id]/away-recap/route.ts
// "While you were away" — a dedicated checkpoint separate from the main
// campaign GET (which the story page polls constantly via Pusher-triggered
// reloads and would otherwise reset lastViewedAt every few seconds). Only
// the lobby page should call this: it's the actual "I came back and looked"
// signal.
//
// #505: GET reads, POST advances the checkpoint. It used to be one GET that
// did both, which was wrong twice over.
//
// As CSRF: the session cookie is SameSite=Lax, which suppresses cross-site
// fetches and image loads but NOT top-level navigation — so a link on any
// page could make a signed-in visitor burn their own recap window. Small
// damage, but a state change nobody asked for, on the method the whole web
// assumes is safe.
//
// As correctness, which is the bigger half: the server was inferring "the
// player has seen this" from "the response was non-empty". A response lost
// in flight, a tab closed mid-render, a client-side error — each of those
// consumed the absence for good, because nothing records that a recap was
// never delivered. An explicit acknowledgement is the only thing that
// actually knows. The client sends back the checkpoint it was given, so
// events that arrived between the read and the acknowledgement stay
// unseen rather than being skipped.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { buildAwayRecap } from '@/lib/game/awayRecap'
import { describeJournalEntry, CATEGORY_LABELS } from '@/lib/game/absenceJournal'
import { loadAbsenceJournal } from '@/lib/game/absenceJournalQuery'
import { type CampaignRole } from '@/lib/api/visibility'
import { getCampaignMembership } from '@/lib/db/campaignAccess'

/**
 * #396: the durable half of the recap, read off WorldEvent — the record that
 * has always covered every entity type, and that no player surface read.
 *
 * #445: the fog-gated read itself moved to lib/game/absenceJournalQuery.ts so
 * the AI can be a second consumer of it rather than carrying a second copy of
 * the fog rule (see that file). This function is now only the SHAPING of the
 * journal into the route's response.
 */
async function buildAbsenceJournalFor(campaignId: string, since: Date, role: CampaignRole) {
  const journal = await loadAbsenceJournal(campaignId, since, role)

  return {
    turnRange: journal.turnRange,
    totalEvents: journal.totalEvents,
    // #445: says out loud that `entries` is a selection from a longer window,
    // so the UI can render "showing N of M" instead of implying the absence
    // was as small as the sample.
    truncated: journal.truncated,
    categories: journal.categoriesPresent.map((c) => ({ key: c, label: CATEGORY_LABELS[c] })),
    entries: journal.entries.map((entry) => ({
      id: entry.id,
      turnNumber: entry.turnNumber,
      category: entry.category,
      categoryLabel: CATEGORY_LABELS[entry.category],
      // Never entry.reason — that text is GM-grade. See absenceJournal.ts.
      line: describeJournalEntry(entry),
    })),
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
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const previousLastViewedAt = membership.lastViewedAt
    const now = new Date()

    const events = previousLastViewedAt
      ? await prisma.timelineEvent.findMany({
          where: {
            campaignId,
            isOffscreen: true,
            visibility: { in: ['PUBLIC', 'MIXED'] },
            createdAt: { gt: previousLastViewedAt },
          },
          // #396: `turnNumber desc` alone left every row of a turn tied, so
          // which handful survived `take` was whatever Postgres happened to
          // return — arbitrary, and different on every call. Ordering is a
          // total order now.
          orderBy: [{ turnNumber: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          take: 20,
          select: { id: true, title: true, summaryPublic: true, turnNumber: true, createdAt: true },
        })
      : []

    const recap = buildAwayRecap(events, previousLastViewedAt, now)
    const journal = previousLastViewedAt
      ? await buildAbsenceJournalFor(campaignId, previousLastViewedAt, membership.role)
      : null

    // The checkpoint the client sends back to POST once it has actually
    // rendered this. Read from `now`, captured before the queries above, so
    // anything that happened while they ran stays on the unseen side.
    //
    // #396's rule still holds and now lives on the POST: only advance when
    // there was something to show. A player who opens the lobby every half
    // hour used to reset lastViewedAt on every visit, so `awayMs` never
    // reached MIN_AWAY_MS and they could never receive a recap at all —
    // the checkpoint starved the feature it exists for.
    const hasSomethingToShow = Boolean(recap || (journal && journal.entries.length > 0))

    return NextResponse.json({
      recap,
      journal,
      checkpoint: hasSomethingToShow ? now.toISOString() : null,
    })
  } catch (error) {
    console.error('Get away-recap error:', error)
    return NextResponse.json({ error: 'Failed to get away recap' }, { status: 500 })
  }
}

/**
 * Acknowledge a recap: advance lastViewedAt to the checkpoint the matching
 * GET returned. Idempotent and monotonic — replaying an old acknowledgement
 * cannot move the checkpoint backwards and re-show an absence the player has
 * already read.
 */
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
    const membership = await getCampaignMembership(user.userId, campaignId)
    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const checkpoint = new Date(body?.checkpoint)
    if (!body?.checkpoint || Number.isNaN(checkpoint.getTime())) {
      return NextResponse.json({ error: 'A valid checkpoint is required' }, { status: 400 })
    }

    // Never past the present: a client clock running fast, or a crafted
    // value, must not be able to mark future events as already seen.
    const now = new Date()
    if (checkpoint > now) {
      return NextResponse.json({ error: 'Checkpoint is in the future' }, { status: 400 })
    }

    // Never backwards either. `updateMany` with the comparison in the
    // WHERE rather than a read-then-write, so two lobby tabs acknowledging
    // at once cannot interleave into the older value winning.
    const { count } = await prisma.campaignMembership.updateMany({
      where: {
        id: membership.id,
        OR: [{ lastViewedAt: null }, { lastViewedAt: { lt: checkpoint } }],
      },
      data: { lastViewedAt: checkpoint },
    })

    return NextResponse.json({ acknowledged: count > 0, lastViewedAt: checkpoint.toISOString() })
  } catch (error) {
    console.error('Acknowledge away-recap error:', error)
    return NextResponse.json({ error: 'Failed to acknowledge away recap' }, { status: 500 })
  }
}
