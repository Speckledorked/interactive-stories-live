// src/lib/game/calendar.ts
// The in-fiction calendar: converts a durable numeric hour count into a
// display date, using a per-campaign generated calendar structure (month
// names/lengths, weekday names, starting year — see lib/ai/calendarGenerator.ts).
//
// Replaces the old calculateNewDate (sceneResolver.ts), which mutated and
// re-parsed a display string on every call via two non-anchored regexes —
// once a date fell into its "<date> + N days" fallback shape, the next
// call's /Day (\d+)/ still matched the leading "Day X" substring and
// silently dropped the appended tail, a real, confirmed data-loss bug.
// This module fixes that the same way harm.ts's parseHarmState/
// validateHarmState split fixed a similar problem: keep a single durable
// number (WorldMeta.totalElapsedGameHours) as the source of truth, and
// recompute the display string from scratch on every read instead of
// mutating it in place.
//
// Pure, no Prisma import — safe to use from API routes and client
// components alike (matches src/lib/format.ts's precedent).

export interface GeneratedCalendarMonth {
  name: string
  days: number
}

export interface GeneratedCalendar {
  // e.g. "Age of Ash" — an optional era/epoch name appended to the year in
  // display text. Empty string means the universe has no such concept.
  epochLabel: string
  daysPerWeek: number
  weekdayNames: string[]
  months: GeneratedCalendarMonth[]
  startingYear: number
  // 0-based index into `months` the campaign begins on.
  startingMonthIndex: number
  // 1-based day-of-month the campaign begins on.
  startingDay: number
}

// Safety-net fallback only — used when AI generation fails (or for a
// legacy campaign before its lazy backfill runs), never the intended
// experience. Deliberately generic/unthemed (no "January") so it doesn't
// masquerade as a real-world calendar.
export const DEFAULT_CALENDAR: GeneratedCalendar = {
  epochLabel: '',
  daysPerWeek: 7,
  weekdayNames: ['Firstday', 'Secondday', 'Thirdday', 'Fourthday', 'Fifthday', 'Sixthday', 'Seventhday'],
  months: Array.from({ length: 12 }, (_, i) => ({ name: `Month ${i + 1}`, days: 30 })),
  startingYear: 1,
  startingMonthIndex: 0,
  startingDay: 1,
}

export interface FormattedGameDate {
  /** Whole in-game days elapsed since campaign start (hour 0). 0-based. */
  totalDays: number
  /** Hour within the current day, 0-23. */
  hourOfDay: number
  year: number
  monthIndex: number
  monthName: string
  /** 1-based day of month. */
  dayOfMonth: number
  weekdayName: string
  display: string
}

interface CalendarConstants {
  daysPerYear: number
  /** monthStartOffsets[i] = cumulative days before month i, within a year. */
  monthStartOffsets: number[]
  /** 0-based day-of-year the campaign's starting point falls on. */
  startingDayOfYear: number
}

function calendarConstants(calendar: GeneratedCalendar): CalendarConstants {
  const monthStartOffsets: number[] = []
  let cumulative = 0
  for (const month of calendar.months) {
    monthStartOffsets.push(cumulative)
    cumulative += month.days
  }
  const daysPerYear = cumulative
  const startingDayOfYear = monthStartOffsets[calendar.startingMonthIndex] + (calendar.startingDay - 1)
  return { daysPerYear, monthStartOffsets, startingDayOfYear }
}

/**
 * Converts a durable hour count into a full display date. Recomputed fresh
 * every call — never mutates or re-parses a prior string, so there is
 * nothing here that can silently lose data the way calculateNewDate did.
 */
export function formatInGameDate(
  totalElapsedGameHours: number,
  calendar: GeneratedCalendar | null
): FormattedGameDate {
  const cal = calendar || DEFAULT_CALENDAR
  const safeHours = Math.max(0, totalElapsedGameHours)
  const totalDays = Math.floor(safeHours / 24)
  const hourOfDay = Math.floor(safeHours % 24)

  const { daysPerYear, monthStartOffsets, startingDayOfYear } = calendarConstants(cal)
  const totalAbsoluteDay = startingDayOfYear + totalDays
  const yearsElapsed = Math.floor(totalAbsoluteDay / daysPerYear)
  const year = cal.startingYear + yearsElapsed
  const dayInYear = totalAbsoluteDay - yearsElapsed * daysPerYear

  let monthIndex = 0
  for (let i = cal.months.length - 1; i >= 0; i--) {
    if (dayInYear >= monthStartOffsets[i]) {
      monthIndex = i
      break
    }
  }
  const dayOfMonth = dayInYear - monthStartOffsets[monthIndex] + 1
  const weekdayName = cal.weekdayNames[totalAbsoluteDay % cal.daysPerWeek]
  const monthName = cal.months[monthIndex].name

  const yearLabel = cal.epochLabel ? `Year ${year} of the ${cal.epochLabel}` : `Year ${year}`
  const display = hourOfDay > 0
    ? `${dayOfMonth} ${monthName}, ${yearLabel}, ${hourOfDay}:00`
    : `${dayOfMonth} ${monthName}, ${yearLabel}`

  return { totalDays, hourOfDay, year, monthIndex, monthName, dayOfMonth, weekdayName, display }
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

const SEASON_ORDER: Season[] = ['spring', 'summer', 'autumn', 'winter']

/**
 * #118: which of four generic seasons the campaign's current in-game date
 * falls in — a quarter of the calendar's month count, not tied to any real
 * month name (fantasy calendars have arbitrary, often unthemed month names
 * — see DEFAULT_CALENDAR's own comment — so there is no "January" to key
 * off). A 4-month calendar has one season per month; a 12-month one has
 * three months per season, same as the real world's quarters. Deliberately
 * NOT anchored to the calendar's authored theme (no "harvest festival"
 * month lookup) — every campaign gets the same reliable quarter-cycle
 * regardless of how its months are named.
 */
export function deriveSeason(
  totalElapsedGameHours: number,
  calendar: GeneratedCalendar | null
): Season {
  const cal = calendar || DEFAULT_CALENDAR
  const { monthIndex } = formatInGameDate(totalElapsedGameHours, cal)
  const monthCount = cal.months.length || 1
  const seasonIndex = Math.min(SEASON_ORDER.length - 1, Math.floor((monthIndex / monthCount) * SEASON_ORDER.length))
  return SEASON_ORDER[seasonIndex]
}

/**
 * Which absolute day numbers (the same 0-based totalDays formatInGameDate
 * returns, and what's stored in CampaignLog/TimelineEvent.inGameDayNumber)
 * fall within (year, monthIndex) of this calendar — for the Story Log's
 * month-grid, so it can query "which days in this month have entries" in
 * one range query instead of walking every day individually.
 */
export function dayNumberRangeForMonth(
  calendar: GeneratedCalendar | null,
  year: number,
  monthIndex: number
): { startDayNumber: number; endDayNumberExclusive: number } {
  const cal = calendar || DEFAULT_CALENDAR
  const { daysPerYear, monthStartOffsets, startingDayOfYear } = calendarConstants(cal)
  const clampedMonthIndex = Math.max(0, Math.min(cal.months.length - 1, monthIndex))

  const targetAbsoluteDay = (year - cal.startingYear) * daysPerYear + monthStartOffsets[clampedMonthIndex]
  const startDayNumber = targetAbsoluteDay - startingDayOfYear
  const endDayNumberExclusive = startDayNumber + cal.months[clampedMonthIndex].days

  return { startDayNumber, endDayNumberExclusive }
}

const CLEAN_DAY_ONLY = /^Day (\d+)$/
const CLEAN_DAY_TIME = /^Day (\d+), (\d+):(\d+)$/

/**
 * Best-effort, forward-only recovery of a legacy "Day N"/"Day N, HH:MM"
 * string into a hour count. Deliberately anchored (^...$) rather than the
 * old calculateNewDate's prefix-matching regexes — a string that has
 * anything appended beyond one of these two exact shapes (i.e. it already
 * hit the old fallback path at least once) returns null rather than
 * silently recovering just the leading anchor and pretending the dropped
 * tail never happened. That data is genuinely gone; see this module's
 * header comment.
 */
export function parseLegacyInGameDate(raw: string | null): { totalHours: number } | null {
  if (!raw) return null

  const dayOnly = raw.match(CLEAN_DAY_ONLY)
  if (dayOnly) {
    const day = parseInt(dayOnly[1], 10)
    if (!Number.isFinite(day) || day < 1) return null
    return { totalHours: (day - 1) * 24 }
  }

  const dayTime = raw.match(CLEAN_DAY_TIME)
  if (dayTime) {
    const day = parseInt(dayTime[1], 10)
    const hour = parseInt(dayTime[2], 10)
    if (!Number.isFinite(day) || day < 1 || !Number.isFinite(hour) || hour < 0) return null
    return { totalHours: (day - 1) * 24 + hour }
  }

  return null
}


// ---------------------------------------------------------------------------
// #402: ONE authority for time of day
// ---------------------------------------------------------------------------
//
// There were two, and nothing reconciled them:
//
//   - npcTick.ts's `TIME_OF_DAY[turnNumber % 4]`, and
//   - this file's `hourOfDay = totalElapsedGameHours % 24`, which is what
//     the player actually sees.
//
// So NPC commutes ran on a clock unrelated to the date and time in the
// fiction: the narration could say late evening while the tick believed it
// was morning and relocated the whole cast to their work locations.
//
// It compounded badly with the frozen turn counter (#374) — `turn % 4` is
// constant on an idle campaign, so the NPC clock was not merely wrong, it
// was STOPPED: evening/night froze every major NPC in place forever,
// morning/afternoon relocated every NPC on every single tick forever.
//
// This is the authority. Anything asking "what time is it in the fiction"
// derives it from elapsed hours.

export const TIMES_OF_DAY = ['morning', 'afternoon', 'evening', 'night'] as const
export type TimeOfDay = (typeof TIMES_OF_DAY)[number]

/**
 * Time of day from the in-fiction clock.
 *
 * Six-hour quarters starting at midnight: night 0-5, morning 6-11,
 * afternoon 12-17, evening 18-23. Chosen so the labels line up with the
 * hour the calendar already displays, rather than inventing a third
 * scheme.
 */
export function timeOfDayFromHours(totalElapsedGameHours: number): TimeOfDay {
  const hour = Math.floor(((totalElapsedGameHours % 24) + 24) % 24)
  if (hour < 6) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}
