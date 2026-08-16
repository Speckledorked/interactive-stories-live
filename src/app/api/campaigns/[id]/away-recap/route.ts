// src/app/api/campaigns/[id]/away-recap/route.ts
// "While you were away" — a dedicated checkpoint separate from the main
// campaign GET (which the story page polls constantly via Pusher-triggered
// reloads and would otherwise reset lastViewedAt every few seconds). Only
// the lobby page should call this: it's the actual "I came back and looked"
// signal.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { buildAwayRecap } from '@/lib/game/awayRecap'
import {
  buildAbsenceJournal,
  describeJournalEntry,
  CATEGORY_LABELS,
  MAX_JOURNAL_ENTRIES,
} from '@/lib/game/absenceJournal'
import { DISCOVERY_GATED_ENTITY_TYPES } from '@/lib/notifications/world-digest'
import { visibleTo, type CampaignRole } from '@/lib/api/visibility'
import { getCampaignMembership } from '@/lib/db/campaignAccess'

/** How many raw WorldEvent rows one reconstruction reads before selecting. */
const JOURNAL_SCAN_LIMIT = 400

/**
 * #396: the durable half of the recap, read off WorldEvent — the record
 * that has always covered every entity type, and that no player surface
 * read.
 *
 * Fog is applied the same way world-digest.ts applies it (#395): per entity
 * TYPE, not per id. Only NPCs and factions model discovery; a location, a
 * clock, a quest, a war or a debt is not something the party "learns
 * exists", so testing those ids against a discovered-entity set built from
 * factions and NPCs would make every one of them structurally unreachable —
 * which is exactly the bug that hid weather and clocks from the digest.
 *
 * The discovered set itself comes from visibleTo(), not a hand-written
 * `isDiscovered: true`, so a GM's own recap is not fogged from them and the
 * polarity is decided in one place (clocks gate on isHidden, inverted).
 */
async function buildAbsenceJournalFor(campaignId: string, since: Date, role: CampaignRole) {
  const [events, discoveredFactions, discoveredNpcs] = await Promise.all([
    prisma.worldEvent.findMany({
      where: { campaignId, createdAt: { gt: since } },
      orderBy: [{ turnNumber: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: JOURNAL_SCAN_LIMIT,
      select: {
        id: true, turnNumber: true, createdAt: true, targetType: true,
        targetId: true, targetName: true, field: true,
        significant: true, importance: true,
      },
    }),
    prisma.faction.findMany({ where: { campaignId, ...visibleTo('faction', role) }, select: { id: true } }),
    prisma.nPC.findMany({ where: { campaignId, ...visibleTo('npc', role) }, select: { id: true } }),
  ])

  const discoveredIds = new Set([...discoveredFactions, ...discoveredNpcs].map((e) => e.id))
  const gated = new Set<string>(DISCOVERY_GATED_ENTITY_TYPES)
  const visible = events.filter((e) => (gated.has(e.targetType) ? discoveredIds.has(e.targetId) : true))

  const journal = buildAbsenceJournal(visible, MAX_JOURNAL_ENTRIES)

  return {
    turnRange: journal.turnRange,
    totalEvents: journal.totalEvents,
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

    // #396: only advance the checkpoint when the player was actually shown
    // something. This used to fire unconditionally, which had two costs.
    // A player who opens the lobby every half hour reset lastViewedAt on
    // every visit, so `awayMs` never reached MIN_AWAY_MS and they could
    // never receive a recap at all — the checkpoint starved the feature it
    // exists for. And a response lost in flight still burned the window:
    // the absence it described was gone for good, because nothing else
    // records that it was never delivered. Not advancing on an empty recap
    // makes the call idempotent in the way that matters — repeat it and you
    // get the same answer until it has something to say.
    if (recap || (journal && journal.entries.length > 0)) {
      await prisma.campaignMembership.update({
        where: { id: membership.id },
        data: { lastViewedAt: now },
      })
    }

    return NextResponse.json({ recap, journal })
  } catch (error) {
    console.error('Get away-recap error:', error)
    return NextResponse.json({ error: 'Failed to get away recap' }, { status: 500 })
  }
}
