// src/lib/ai/__tests__/calendarGenerator.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateCalendar } from '../calendarGenerator'

function mockCompletion(content: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  })
}

function validCalendar(overrides: Record<string, unknown> = {}) {
  return {
    epoch_label: 'Age of Ash',
    days_per_week: 5,
    weekday_names: ['Emberday', 'Ashday', 'Coalday', 'Smokeday', 'Cinderday'],
    months: [
      { name: 'Frostmoon', days: 28 },
      { name: 'Emberfall', days: 31 },
      { name: 'Thornrise', days: 30 },
      { name: 'Duskveil', days: 30 },
    ],
    starting_year: 3,
    starting_month_index: 1,
    starting_day: 14,
    ...overrides,
  }
}

describe('generateCalendar', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('returns null without an API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(await generateCalendar('T', '', 'U')).toBeNull()
  })

  it('returns null on API error', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await generateCalendar('T', '', 'U')).toBeNull()
  })

  it('returns null on malformed JSON content', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
    }))
    expect(await generateCalendar('T', '', 'U')).toBeNull()
  })

  it('parses a fully valid calendar', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion(validCalendar()))

    const result = await generateCalendar('The Iron Vigil', 'desc', 'Grimdark Fantasy')
    expect(result).toEqual({
      epochLabel: 'Age of Ash',
      daysPerWeek: 5,
      weekdayNames: ['Emberday', 'Ashday', 'Coalday', 'Smokeday', 'Cinderday'],
      months: [
        { name: 'Frostmoon', days: 28 },
        { name: 'Emberfall', days: 31 },
        { name: 'Thornrise', days: 30 },
        { name: 'Duskveil', days: 30 },
      ],
      startingYear: 3,
      startingMonthIndex: 1,
      startingDay: 14,
    })
  })

  it('accepts an empty epoch_label', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion(validCalendar({ epoch_label: '' })))
    const result = await generateCalendar('T', '', 'U')
    expect(result?.epochLabel).toBe('')
  })

  it('rejects too few months', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion(validCalendar({ months: [{ name: 'A', days: 30 }] })))
    expect(await generateCalendar('T', '', 'U')).toBeNull()
  })

  it('rejects too many months', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const months = Array.from({ length: 20 }, (_, i) => ({ name: `M${i}`, days: 30 }))
    vi.stubGlobal('fetch', mockCompletion(validCalendar({ months })))
    expect(await generateCalendar('T', '', 'U')).toBeNull()
  })

  it('rejects a month with out-of-range days', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion(validCalendar({
      months: [{ name: 'Tiny', days: 2 }, { name: 'B', days: 30 }, { name: 'C', days: 30 }, { name: 'D', days: 30 }],
    })))
    expect(await generateCalendar('T', '', 'U')).toBeNull()

    vi.stubGlobal('fetch', mockCompletion(validCalendar({
      months: [{ name: 'Huge', days: 90 }, { name: 'B', days: 30 }, { name: 'C', days: 30 }, { name: 'D', days: 30 }],
    })))
    expect(await generateCalendar('T', '', 'U')).toBeNull()
  })

  it('rejects daysPerWeek out of range', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion(validCalendar({ days_per_week: 2, weekday_names: ['A', 'B'] })))
    expect(await generateCalendar('T', '', 'U')).toBeNull()

    vi.stubGlobal('fetch', mockCompletion(validCalendar({ days_per_week: 15, weekday_names: Array(15).fill('A') })))
    expect(await generateCalendar('T', '', 'U')).toBeNull()
  })

  it('rejects a weekday_names length mismatch', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion(validCalendar({ weekday_names: ['OnlyOne'] })))
    expect(await generateCalendar('T', '', 'U')).toBeNull()
  })

  it('rejects an out-of-range starting_month_index', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion(validCalendar({ starting_month_index: 99 })))
    expect(await generateCalendar('T', '', 'U')).toBeNull()

    vi.stubGlobal('fetch', mockCompletion(validCalendar({ starting_month_index: -1 })))
    expect(await generateCalendar('T', '', 'U')).toBeNull()
  })

  it('rejects a starting_day outside the starting month\'s length', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    // starting_month_index 1 ("Emberfall") has 31 days
    vi.stubGlobal('fetch', mockCompletion(validCalendar({ starting_day: 32 })))
    expect(await generateCalendar('T', '', 'U')).toBeNull()

    vi.stubGlobal('fetch', mockCompletion(validCalendar({ starting_day: 0 })))
    expect(await generateCalendar('T', '', 'U')).toBeNull()
  })

  it('rejects a non-positive starting_year', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion(validCalendar({ starting_year: 0 })))
    expect(await generateCalendar('T', '', 'U')).toBeNull()

    vi.stubGlobal('fetch', mockCompletion(validCalendar({ starting_year: -3 })))
    expect(await generateCalendar('T', '', 'U')).toBeNull()
  })

  it('rejects a month missing a name', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion(validCalendar({
      months: [{ name: '', days: 30 }, { name: 'B', days: 30 }, { name: 'C', days: 30 }, { name: 'D', days: 30 }],
    })))
    expect(await generateCalendar('T', '', 'U')).toBeNull()
  })
})
