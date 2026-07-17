// src/lib/game/__tests__/awayRecap.test.ts
import { describe, it, expect } from 'vitest'
import { formatAwayDuration, buildAwayRecap, MIN_AWAY_MS, RecapEventInput } from '../awayRecap'

describe('formatAwayDuration', () => {
  it('describes sub-hour gaps as a few minutes', () => {
    expect(formatAwayDuration(20 * 60 * 1000)).toBe('a few minutes')
  })

  it('describes 1-2 hour gaps as about an hour', () => {
    expect(formatAwayDuration(90 * 60 * 1000)).toBe('about an hour')
  })

  it('describes multi-hour gaps in hours', () => {
    expect(formatAwayDuration(5 * 60 * 60 * 1000)).toBe('about 5 hours')
  })

  it('describes a day-ish gap as about a day', () => {
    expect(formatAwayDuration(30 * 60 * 60 * 1000)).toBe('about a day')
  })

  it('describes multi-day gaps in days', () => {
    expect(formatAwayDuration(4 * 24 * 60 * 60 * 1000)).toBe('about 4 days')
  })

  it('describes week-scale gaps in weeks', () => {
    expect(formatAwayDuration(20 * 24 * 60 * 60 * 1000)).toBe('about 3 weeks')
  })

  it('describes month-scale gaps in months', () => {
    expect(formatAwayDuration(60 * 24 * 60 * 60 * 1000)).toBe('about 2 months')
  })
})

describe('buildAwayRecap', () => {
  const now = new Date('2026-07-17T12:00:00Z')

  const event = (overrides: Partial<RecapEventInput> = {}): RecapEventInput => ({
    id: 'e1',
    title: 'The Iron Company seizes the docks',
    summaryPublic: 'Word spreads that the Iron Company has taken the harbor district by force.',
    turnNumber: 5,
    createdAt: new Date('2026-07-16T00:00:00Z'),
    ...overrides,
  })

  it('returns null when the member has never visited before', () => {
    expect(buildAwayRecap([event()], null, now)).toBeNull()
  })

  it('returns null when the gap is below the noise threshold', () => {
    const justNow = new Date(now.getTime() - (MIN_AWAY_MS - 1000))
    expect(buildAwayRecap([event()], justNow, now)).toBeNull()
  })

  it('returns null when nothing offscreen happened, even after a long gap', () => {
    const longAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)
    expect(buildAwayRecap([], longAgo, now)).toBeNull()
  })

  it('builds a recap with the away label and events in chronological order', () => {
    const longAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
    const first = event({ id: 'e1', turnNumber: 3, title: 'First' })
    const second = event({ id: 'e2', turnNumber: 5, title: 'Second' })
    const recap = buildAwayRecap([second, first], longAgo, now)

    expect(recap).not.toBeNull()
    expect(recap!.awayLabel).toBe('about 3 days')
    expect(recap!.events.map(e => e.title)).toEqual(['First', 'Second'])
  })

  it('caps the recap at the 5 most recent events', () => {
    const longAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
    const events = Array.from({ length: 8 }, (_, i) =>
      event({ id: `e${i}`, turnNumber: i, title: `Event ${i}` })
    )
    const recap = buildAwayRecap(events, longAgo, now)

    expect(recap!.events).toHaveLength(5)
    expect(recap!.events.map(e => e.title)).toEqual([
      'Event 3', 'Event 4', 'Event 5', 'Event 6', 'Event 7',
    ])
  })

  it('falls back to the title when summaryPublic is missing', () => {
    const longAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
    const recap = buildAwayRecap([event({ summaryPublic: null })], longAgo, now)
    expect(recap!.events[0].summary).toBe(event().title)
  })
})
