// src/lib/game/calendarBackfill.ts
// One-time, lazy backfill for campaigns created before the in-fiction
// calendar existed (Campaign.calendarConfig is null). Triggered by the
// next scene resolution for that campaign — sceneResolver.ts is the sole
// WorldMeta/turn writer, so running this there avoids races from multiple
// simultaneous readers (the Story Log page, the wiki page, the exporter)
// all trying to write calendarConfig at once.
//
// Decided explicitly (not a default assumption): existing campaigns get a
// REAL generated calendar too, via the same generator creation-time
// campaigns use, run now instead — not a permanent generic placeholder.

import { prisma } from '@/lib/prisma'
import { generateCalendar } from '@/lib/ai/calendarGenerator'
import { DEFAULT_CALENDAR, parseLegacyInGameDate, type GeneratedCalendar } from './calendar'

export interface ResolvedLegacyCalendar {
  calendar: GeneratedCalendar
  /**
   * The effective totalElapsedGameHours to build on — may be higher than
   * what was passed in if a legacy "Day N"/"Day N, HH:MM" string was
   * successfully recovered (see parseLegacyInGameDate). Already persisted
   * to WorldMeta by this function; the caller doesn't need to write it
   * again, only use it as the base for this exchange's own update.
   */
  totalElapsedGameHours: number
}

export async function resolveLegacyCalendar(
  campaign: { id: string; title: string; description: string | null; universe: string | null },
  worldMeta: { currentInGameDate: string | null; totalElapsedGameHours: number }
): Promise<ResolvedLegacyCalendar> {
  let totalElapsedGameHours = worldMeta.totalElapsedGameHours

  // Only meaningful the very first time this runs: every pre-existing
  // WorldMeta row starts this column at the schema default of 0. An
  // anchored parse only — see parseLegacyInGameDate's header comment for
  // why a date string that already degraded into the old fallback's
  // "<date> + N days" shape can't be recovered further; that data is gone.
  if (totalElapsedGameHours === 0) {
    const legacy = parseLegacyInGameDate(worldMeta.currentInGameDate)
    if (legacy) {
      totalElapsedGameHours = legacy.totalHours
      await prisma.worldMeta.update({
        where: { campaignId: campaign.id },
        data: { totalElapsedGameHours },
      }).catch((err: unknown) => {
        console.error('Legacy hour recovery write failed (non-critical):', err)
      })
    }
  }

  // generateCalendar already fails open (returns null, never throws) — see
  // lib/ai/calendarGenerator.ts.
  const generated = await generateCalendar(
    campaign.title,
    campaign.description || '',
    campaign.universe || 'Generic Fantasy'
  )
  const calendar = generated || DEFAULT_CALENDAR

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { calendarConfig: calendar as object },
  }).catch((err: unknown) => {
    console.error('Calendar backfill write failed (non-critical):', err)
  })

  return { calendar, totalElapsedGameHours }
}
