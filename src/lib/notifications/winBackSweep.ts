// src/lib/notifications/winBackSweep.ts
//
// #506 — the sweep that turns the win-back decision into mail.
//
// Reads every membership that might have lapsed, asks winBack.ts whether to
// write, and builds what it says from the SAME absence journal the lobby
// renders on return. That reuse is the point, not a shortcut: the journal
// is already fog-gated per role (loadAbsenceJournal takes the member's own
// role and filters undiscovered factions and NPCs out), already picks for
// category coverage rather than recency, and already renders through
// describeJournalEntry, which never touches WorldEvent.reason because that
// field is GM-grade and routinely names things players have not learned.
//
// A second, independently-written copy path for the email is exactly how an
// undiscovered faction ends up in somebody's inbox, where no amount of
// later fog-gating can recall it. So there isn't one.
//
// Runs on the daily cron. Bounded per sweep, best-effort per member: one
// member's failed send must not cost the rest the run.

import { prisma } from '@/lib/prisma'
import { loadAbsenceJournal } from '@/lib/game/absenceJournalQuery'
import { EmailService } from './email-service'
import {
  decideWinBack,
  describeAbsence,
  ABANDON_AFTER_DAYS,
  LAPSE_AFTER_DAYS,
  type WinBackSkipReason,
} from './winBack'

/**
 * How many memberships one sweep will mail. The cron invocation is shared
 * with the world-turn sweep's own duration budget, and a burst of mail is
 * also the shape most likely to get a sending domain throttled. The
 * remainder is not lost — a lapsed seat stays lapsed, and tomorrow's sweep
 * picks it up.
 */
export const MAX_SENDS_PER_SWEEP = 50

export interface WinBackSweepResult {
  considered: number
  sent: number
  failed: number
  skipped: Record<WinBackSkipReason, number>
}

function emptySkipTally(): Record<WinBackSkipReason, number> {
  return {
    'emails-off': 0,
    'never-visited': 0,
    'still-active': 0,
    'abandoned': 0,
    'nothing-happened': 0,
    'cooling-down': 0,
    'cap-reached': 0,
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

export async function sweepWinBackEmails(now: Date = new Date()): Promise<WinBackSweepResult> {
  const result: WinBackSweepResult = {
    considered: 0,
    sent: 0,
    failed: 0,
    skipped: emptySkipTally(),
  }

  // The window is applied in the QUERY, not just in the decider: without it
  // this reads every membership in the product every night to discard almost
  // all of them. The decider still re-checks — it owns the rule — but it
  // should not be handed rows that cannot possibly qualify.
  const lapsedBefore = new Date(now.getTime() - LAPSE_AFTER_DAYS * DAY_MS)
  const abandonedBefore = new Date(now.getTime() - ABANDON_AFTER_DAYS * DAY_MS)

  const candidates = await prisma.campaignMembership.findMany({
    where: {
      lastViewedAt: { lt: lapsedBefore, gte: abandonedBefore },
    },
    select: {
      id: true,
      userId: true,
      campaignId: true,
      role: true,
      lastViewedAt: true,
      winBackSentAt: true,
      winBackCount: true,
      user: { select: { email: true, name: true } },
      campaign: { select: { title: true } },
    },
    // Oldest-lapsed first, so a sweep that hits the cap works through the
    // backlog in a stable order instead of re-rolling the same arbitrary
    // slice every night and never reaching the rest.
    orderBy: { lastViewedAt: 'asc' },
    take: MAX_SENDS_PER_SWEEP * 4,
  })

  if (candidates.length === 0) return result

  const settings = await prisma.userNotificationSettings.findMany({
    where: { userId: { in: [...new Set(candidates.map((c) => c.userId))] } },
    select: { userId: true, emailEnabled: true, emailWinBack: true },
  })
  const settingsByUser = new Map(settings.map((s) => [s.userId, s]))

  for (const candidate of candidates) {
    if (result.sent >= MAX_SENDS_PER_SWEEP) break
    result.considered++

    // No settings row means defaults, and both defaults are on. Reading a
    // missing row as "off" would silently exclude every user who never
    // opened the settings page, which is most of them.
    const setting = settingsByUser.get(candidate.userId)
    const emailsAllowed = (setting?.emailEnabled ?? true) && (setting?.emailWinBack ?? true)

    // Cheap refusals first, before any per-campaign read.
    const preCheck = decideWinBack(
      {
        lastViewedAt: candidate.lastViewedAt,
        winBackSentAt: candidate.winBackSentAt,
        winBackCount: candidate.winBackCount,
        // Assumed true for now; the real answer costs a query, and every
        // other rule can refuse without it.
        hasNewActivity: true,
        emailsAllowed,
      },
      now
    )
    if (!preCheck.send) {
      result.skipped[preCheck.reason]++
      continue
    }

    try {
      const journal = await loadAbsenceJournal(
        candidate.campaignId,
        candidate.lastViewedAt!,
        candidate.role
      )

      // The honesty rule, now with the real answer. `entries` rather than
      // totalEvents: a window full of events none of which this member is
      // allowed to see renders an empty letter, and an empty letter is the
      // "we miss you" mail this feature exists not to send.
      if (journal.entries.length === 0) {
        result.skipped['nothing-happened']++
        continue
      }

      const sent = await EmailService.sendWinBackEmail({
        to: candidate.user.email,
        campaignTitle: candidate.campaign.title,
        absence: describeAbsence(preCheck.daysAway),
        journal,
      })

      if (!sent) {
        // A transporter that is not configured returns false rather than
        // throwing. Recording a send that did not happen would burn one of
        // three lifetime letters on nothing.
        result.failed++
        continue
      }

      await prisma.campaignMembership.update({
        where: { id: candidate.id },
        data: { winBackSentAt: now, winBackCount: { increment: 1 } },
      })
      result.sent++
    } catch (error) {
      console.error(`Win-back send failed for membership ${candidate.id} (non-fatal):`, error)
      result.failed++
    }
  }

  return result
}
