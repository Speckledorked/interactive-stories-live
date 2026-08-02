// src/lib/game/__tests__/calendar.test.ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CALENDAR,
  formatInGameDate,
  dayNumberRangeForMonth,
  parseLegacyInGameDate,
  deriveSeason,
  type GeneratedCalendar,
} from '../calendar'

describe('formatInGameDate with DEFAULT_CALENDAR (12 x 30-day months, starting Year 1, Month 1, Day 1)', () => {
  it('is Day 1 of Month 1 at hour 0', () => {
    const d = formatInGameDate(0, DEFAULT_CALENDAR)
    expect(d).toMatchObject({ totalDays: 0, hourOfDay: 0, year: 1, monthIndex: 0, dayOfMonth: 1 })
    expect(d.display).toBe('1 Month 1, Year 1')
  })

  it('advances within the same month', () => {
    const d = formatInGameDate(24 * 5, DEFAULT_CALENDAR)
    expect(d).toMatchObject({ totalDays: 5, dayOfMonth: 6, monthIndex: 0, year: 1 })
  })

  it('rolls over into the next month at the month boundary', () => {
    // 30 days after start = day 31 overall -> Month 2, day 1
    const d = formatInGameDate(24 * 30, DEFAULT_CALENDAR)
    expect(d).toMatchObject({ monthIndex: 1, dayOfMonth: 1, year: 1 })
  })

  it('rolls over into the next year after 12 months', () => {
    // 360 days (12 * 30) after start = Year 2, Month 1, Day 1
    const d = formatInGameDate(24 * 360, DEFAULT_CALENDAR)
    expect(d).toMatchObject({ year: 2, monthIndex: 0, dayOfMonth: 1 })
  })

  it('includes the hour only when non-zero', () => {
    expect(formatInGameDate(5, DEFAULT_CALENDAR).display).toBe('1 Month 1, Year 1, 5:00')
    expect(formatInGameDate(24, DEFAULT_CALENDAR).display).toBe('2 Month 1, Year 1')
  })

  it('falls back to DEFAULT_CALENDAR when given null', () => {
    expect(formatInGameDate(0, null)).toEqual(formatInGameDate(0, DEFAULT_CALENDAR))
  })

  it('clamps negative hours to zero rather than going negative', () => {
    expect(formatInGameDate(-100, DEFAULT_CALENDAR)).toMatchObject({ totalDays: 0, dayOfMonth: 1 })
  })
})

describe('formatInGameDate with a custom calendar', () => {
  const custom: GeneratedCalendar = {
    epochLabel: 'Age of Ash',
    daysPerWeek: 5,
    weekdayNames: ['Emberday', 'Ashday', 'Coalday', 'Smokeday', 'Cinderday'],
    months: [
      { name: 'Frostmoon', days: 28 },
      { name: 'Emberfall', days: 31 },
      { name: 'Thornrise', days: 30 },
    ],
    startingYear: 3,
    startingMonthIndex: 1, // Emberfall
    startingDay: 14,
  }

  it('starts at the configured starting point', () => {
    const d = formatInGameDate(0, custom)
    expect(d.display).toBe('14 Emberfall, Year 3 of the Age of Ash')
  })

  it('rolls from Emberfall into Thornrise mid-month-length', () => {
    // Emberfall has 31 days; starting on day 14, day 31 (17 days later)
    // is still Emberfall's last day — day 32 (18 days later) is what
    // rolls into Thornrise day 1.
    const d = formatInGameDate(24 * 18, custom)
    expect(d).toMatchObject({ monthIndex: 2, dayOfMonth: 1 })
    expect(d.monthName).toBe('Thornrise')
  })

  it('wraps months (variable lengths) and years correctly over a long span', () => {
    // Full custom year = 28 + 31 + 30 = 89 days.
    const d = formatInGameDate(24 * 89, custom)
    expect(d).toMatchObject({ year: 4, monthIndex: 1, dayOfMonth: 14 })
  })

  it('uses the custom weekday names', () => {
    const d = formatInGameDate(0, custom)
    expect(custom.weekdayNames).toContain(d.weekdayName)
  })
})

describe('dayNumberRangeForMonth', () => {
  it('round-trips with formatInGameDate for DEFAULT_CALENDAR', () => {
    const { startDayNumber, endDayNumberExclusive } = dayNumberRangeForMonth(DEFAULT_CALENDAR, 1, 1)
    expect(startDayNumber).toBe(30) // Month 2 starts on absolute day 30 (0-based)
    expect(endDayNumberExclusive).toBe(60)

    const firstDayOfMonth2 = formatInGameDate(startDayNumber * 24, DEFAULT_CALENDAR)
    expect(firstDayOfMonth2).toMatchObject({ monthIndex: 1, dayOfMonth: 1 })

    const lastDayOfMonth2 = formatInGameDate((endDayNumberExclusive - 1) * 24, DEFAULT_CALENDAR)
    expect(lastDayOfMonth2).toMatchObject({ monthIndex: 1, dayOfMonth: 30 })

    const firstDayOfMonth3 = formatInGameDate(endDayNumberExclusive * 24, DEFAULT_CALENDAR)
    expect(firstDayOfMonth3).toMatchObject({ monthIndex: 2, dayOfMonth: 1 })
  })

  it('handles a custom calendar whose starting point is mid-month', () => {
    const custom: GeneratedCalendar = {
      epochLabel: '',
      daysPerWeek: 7,
      weekdayNames: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      months: [{ name: 'One', days: 20 }, { name: 'Two', days: 20 }],
      startingYear: 1,
      startingMonthIndex: 0,
      startingDay: 10,
    }
    // Month "Two" (index 1) of year 1.
    const { startDayNumber, endDayNumberExclusive } = dayNumberRangeForMonth(custom, 1, 1)
    const firstDay = formatInGameDate(startDayNumber * 24, custom)
    expect(firstDay).toMatchObject({ monthIndex: 1, dayOfMonth: 1 })
    expect(endDayNumberExclusive - startDayNumber).toBe(20)
  })

  it('finds a future year correctly', () => {
    const { startDayNumber } = dayNumberRangeForMonth(DEFAULT_CALENDAR, 3, 0)
    // Year 3 starts after 2 full 360-day years.
    expect(startDayNumber).toBe(720)
  })
})

describe('parseLegacyInGameDate', () => {
  it('parses a clean "Day N" string', () => {
    expect(parseLegacyInGameDate('Day 1')).toEqual({ totalHours: 0 })
    expect(parseLegacyInGameDate('Day 5')).toEqual({ totalHours: 96 })
  })

  it('parses a clean "Day N, HH:MM" string, ignoring minutes', () => {
    expect(parseLegacyInGameDate('Day 5, 13:00')).toEqual({ totalHours: 4 * 24 + 13 })
  })

  it('returns null for the degraded "<date> + N days/hours" fallback shape', () => {
    // This is the confirmed data-loss case: the old calculateNewDate would
    // silently recover just "Day 5" here and drop "+ 2 days" entirely.
    // parseLegacyInGameDate refuses to partially recover it instead.
    expect(parseLegacyInGameDate('Day 5 + 2 days')).toBeNull()
    expect(parseLegacyInGameDate('Day 5, 13:00 + 6 hours')).toBeNull()
  })

  it('returns null for null, empty, or unrecognized input', () => {
    expect(parseLegacyInGameDate(null)).toBeNull()
    expect(parseLegacyInGameDate('')).toBeNull()
    expect(parseLegacyInGameDate('sometime next week')).toBeNull()
  })
})

describe('deriveSeason (#118)', () => {
  it('is spring at the very start of the campaign', () => {
    expect(deriveSeason(0, DEFAULT_CALENDAR)).toBe('spring')
  })

  it('divides a 12-month calendar into four clean 3-month quarters', () => {
    // DEFAULT_CALENDAR: 12 months x 30 days = 360 days/year.
    expect(deriveSeason(24 * 30 * 0, DEFAULT_CALENDAR)).toBe('spring')  // month 0
    expect(deriveSeason(24 * 30 * 3, DEFAULT_CALENDAR)).toBe('summer')  // month 3
    expect(deriveSeason(24 * 30 * 6, DEFAULT_CALENDAR)).toBe('autumn')  // month 6
    expect(deriveSeason(24 * 30 * 9, DEFAULT_CALENDAR)).toBe('winter')  // month 9
  })

  it('cycles back to spring in year 2', () => {
    expect(deriveSeason(24 * 360, DEFAULT_CALENDAR)).toBe('spring')
  })

  it('falls back to DEFAULT_CALENDAR when given null, same as formatInGameDate', () => {
    expect(deriveSeason(24 * 30 * 6, null)).toBe(deriveSeason(24 * 30 * 6, DEFAULT_CALENDAR))
  })

  it('gives every month its own season on a 4-month calendar', () => {
    const fourMonth: GeneratedCalendar = {
      epochLabel: '',
      daysPerWeek: 7,
      weekdayNames: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      months: [{ name: 'M1', days: 30 }, { name: 'M2', days: 30 }, { name: 'M3', days: 30 }, { name: 'M4', days: 30 }],
      startingYear: 1,
      startingMonthIndex: 0,
      startingDay: 1,
    }
    expect(deriveSeason(24 * 30 * 0, fourMonth)).toBe('spring')
    expect(deriveSeason(24 * 30 * 1, fourMonth)).toBe('summer')
    expect(deriveSeason(24 * 30 * 2, fourMonth)).toBe('autumn')
    expect(deriveSeason(24 * 30 * 3, fourMonth)).toBe('winter')
  })

  it('never returns an out-of-range season for the last month of a large calendar', () => {
    const sixteenMonth: GeneratedCalendar = {
      epochLabel: '',
      daysPerWeek: 7,
      weekdayNames: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      months: Array.from({ length: 16 }, (_, i) => ({ name: `M${i + 1}`, days: 20 })),
      startingYear: 1,
      startingMonthIndex: 0,
      startingDay: 1,
    }
    expect(deriveSeason(24 * 20 * 15, sixteenMonth)).toBe('winter')
  })
})
