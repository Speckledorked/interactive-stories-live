// src/lib/ai/calendarGenerator.ts
// Per-campaign in-fiction calendar generation: month names/lengths, weekday
// names, a starting year — invented once at creation (or lazily backfilled
// for a campaign that predates this, see lib/game/calendarBackfill.ts) so
// the calendar feels native to that universe rather than a generic
// Gregorian one. Same fail-open shape as moveFlavor.ts/worldExtras.ts:
// a failed call never blocks anything, it just means the campaign falls
// back to DEFAULT_CALENDAR (lib/game/calendar.ts) — a working, if
// unthemed, 12-month grid rather than no calendar at all.
//
// Mechanics never come from here: the calendar only supplies structure for
// display formatting (lib/game/calendar.ts's formatInGameDate). It has no
// bearing on world-turn pacing, harm recovery, or any other consumer of
// WorldMeta.totalElapsedGameHours — those all keep working in raw hours
// regardless of what calendar (if any) a campaign has.

import { callChatCompletion } from './chatCompletion'
import { AI_MODELS } from './models'
import type { GeneratedCalendar } from '@/lib/game/calendar'

const MIN_MONTHS = 4
const MAX_MONTHS = 16
const MIN_MONTH_DAYS = 10
const MAX_MONTH_DAYS = 60
const MIN_DAYS_PER_WEEK = 4
const MAX_DAYS_PER_WEEK = 10

function validateGeneratedCalendar(raw: unknown): GeneratedCalendar | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const months = Array.isArray(r.months) ? r.months : null
  if (!months || months.length < MIN_MONTHS || months.length > MAX_MONTHS) return null

  const parsedMonths: { name: string; days: number }[] = []
  for (const m of months) {
    if (!m || typeof m !== 'object') return null
    const mm = m as Record<string, unknown>
    const name = String(mm.name || '').trim()
    const days = Number(mm.days)
    if (!name || !Number.isFinite(days) || days < MIN_MONTH_DAYS || days > MAX_MONTH_DAYS) return null
    parsedMonths.push({ name, days: Math.round(days) })
  }

  const daysPerWeek = Number(r.days_per_week)
  if (!Number.isFinite(daysPerWeek) || daysPerWeek < MIN_DAYS_PER_WEEK || daysPerWeek > MAX_DAYS_PER_WEEK) return null

  const weekdayNames = Array.isArray(r.weekday_names) ? r.weekday_names.map(String) : null
  if (!weekdayNames || weekdayNames.length !== daysPerWeek || weekdayNames.some(n => !n.trim())) return null

  const startingYear = Number(r.starting_year)
  if (!Number.isFinite(startingYear) || startingYear <= 0) return null

  const startingMonthIndex = Number(r.starting_month_index)
  if (!Number.isInteger(startingMonthIndex) || startingMonthIndex < 0 || startingMonthIndex >= parsedMonths.length) return null

  const startingDay = Number(r.starting_day)
  if (!Number.isInteger(startingDay) || startingDay < 1 || startingDay > parsedMonths[startingMonthIndex].days) return null

  return {
    epochLabel: typeof r.epoch_label === 'string' ? r.epoch_label.trim() : '',
    daysPerWeek: Math.round(daysPerWeek),
    weekdayNames,
    months: parsedMonths,
    startingYear: Math.round(startingYear),
    startingMonthIndex,
    startingDay,
  }
}

export async function generateCalendar(
  campaignTitle: string,
  campaignDescription: string,
  universe: string
): Promise<GeneratedCalendar | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const prompt = `Invent an in-fiction calendar for a tabletop RPG campaign — something that feels like it belongs to this specific world, not a real-world calendar.

Universe: ${universe}
Campaign: "${campaignTitle}"${campaignDescription ? `\nDescription: "${campaignDescription}"` : ''}

Return JSON:
{
  "epoch_label": "an optional era/age name for the current year, e.g. \\"Age of Ash\\" — empty string if this universe has no such concept",
  "days_per_week": 7,
  "weekday_names": ["...", "...", "...", "...", "...", "...", "..."],
  "months": [
    { "name": "...", "days": 30 }
  ],
  "starting_year": 1,
  "starting_month_index": 0,
  "starting_day": 1
}

Rules:
- 4 to 16 months total, each with an invented, world-appropriate name and a day count between 10 and 60
- days_per_week between 4 and 10, with exactly that many weekday_names, each a distinct invented name
- starting_month_index is 0-based, and starting_day must be a valid day (1 through that month's day count) — this is when the campaign's story begins
- starting_year is a small, sensible number for a campaign's opening (e.g. 1, or a modest number if the setting implies an ongoing era) — not an arbitrarily large real-world-style year
- Names should read as belonging to "${campaignTitle}" specifically, grounded in ${universe} — not generic fantasy or real-world month/day names`

  try {
    const result = await callChatCompletion({
      apiKey,
      model: AI_MODELS.EFFICIENT,
      systemPrompt: 'You invent in-fiction calendar systems for tabletop RPG campaigns. JSON only.',
      userPrompt: prompt,
      temperature: 0.9,
      maxTokens: 1200,
      jsonMode: true,
    })

    if (!result.ok) {
      console.error('Calendar generation API error:', result.status)
      return null
    }

    const raw = JSON.parse(result.content)
    const calendar = validateGeneratedCalendar(raw)
    if (!calendar) {
      console.error('Calendar generation returned an invalid shape, falling back to DEFAULT_CALENDAR')
      return null
    }

    console.log(`✅ Calendar generated: ${calendar.months.length} months, ${calendar.daysPerWeek}-day weeks`)
    return calendar
  } catch (err) {
    console.error('Calendar generation failed (campaign falls back to DEFAULT_CALENDAR):', err)
    return null
  }
}
