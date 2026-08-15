import { describe, it, expect } from 'vitest'
import {
  describeConditionTag,
  describeStability,
  describeThreat,
  describeWeather,
  stabilityTone,
  threatTone,
  THREAT_MAX,
  THREAT_MIN,
} from '../entityStats'

describe('describeThreat', () => {
  it('labels every level in the real 1-5 range', () => {
    expect([1, 2, 3, 4, 5].map(describeThreat)).toEqual([
      'Dormant',
      'Watchful',
      'Active',
      'Dangerous',
      'Dire',
    ])
  })

  // These render a card. A value outside the clamp (a widened range, a
  // hand-edited row) should degrade to the nearest band, never to
  // `undefined` printed into the DOM.
  it('clamps out-of-range levels instead of returning undefined', () => {
    expect(describeThreat(0)).toBe('Dormant')
    expect(describeThreat(-4)).toBe('Dormant')
    expect(describeThreat(9)).toBe('Dire')
  })

  it('rounds a non-integer level', () => {
    expect(describeThreat(2.4)).toBe('Watchful')
    expect(describeThreat(2.6)).toBe('Active')
  })

  it('exposes bounds matching the clamp the tick writers use', () => {
    expect([THREAT_MIN, THREAT_MAX]).toEqual([1, 5])
  })
})

describe('describeStability', () => {
  it('bands the 0-100 range at the quartile boundaries', () => {
    expect(describeStability(0)).toBe('Crumbling')
    expect(describeStability(24)).toBe('Crumbling')
    expect(describeStability(25)).toBe('Strained')
    expect(describeStability(49)).toBe('Strained')
    expect(describeStability(50)).toBe('Steady')
    expect(describeStability(74)).toBe('Steady')
    expect(describeStability(75)).toBe('Entrenched')
    expect(describeStability(100)).toBe('Entrenched')
  })
})

describe('tones', () => {
  // The two meters read in opposite directions, which is the whole reason
  // they don't share a tone function: a full stability bar is good news, a
  // full threat bar is not.
  it('treats low stability as bad and high stability as good', () => {
    expect(stabilityTone(10)).toBe('danger')
    expect(stabilityTone(40)).toBe('warn')
    expect(stabilityTone(90)).toBe('good')
  })

  it('treats high threat as bad and low threat as good', () => {
    expect(threatTone(1)).toBe('good')
    expect(threatTone(2)).toBe('good')
    expect(threatTone(3)).toBe('warn')
    expect(threatTone(5)).toBe('danger')
  })
})

describe('describeWeather', () => {
  it('title-cases the enum value', () => {
    expect(describeWeather('CLEAR', 1)).toBe('Clear')
    expect(describeWeather('STORM', 2)).toBe('Storm')
  })

  it('marks severe weather', () => {
    expect(describeWeather('STORM', 4)).toBe('Storm (severe)')
    expect(describeWeather('SNOW', 5)).toBe('Snow (severe)')
  })

  // Formats whatever the enum holds rather than mapping a fixed list, so
  // a newly added WeatherCondition renders instead of disappearing.
  it('formats a condition it has never seen', () => {
    expect(describeWeather('ASHFALL', 1)).toBe('Ashfall')
  })
})

describe('describeConditionTag', () => {
  it('title-cases the closed tag vocabulary', () => {
    expect(['RUINED', 'DAMAGED', 'STABLE', 'PROSPEROUS', 'ABANDONED', 'CONTESTED'].map(describeConditionTag)).toEqual([
      'Ruined',
      'Damaged',
      'Stable',
      'Prosperous',
      'Abandoned',
      'Contested',
    ])
  })
})
