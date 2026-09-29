import { describe, it, expect } from 'vitest'

import { isSevereWeather } from '../weatherTick'

describe('isSevereWeather — severity bar at 3', () => {
  it('STORM at severity 3 is severe', () => {
    expect(isSevereWeather('STORM', 3)).toBe(true)
  })

  it('STORM at severity 2 is not severe — both sides of the threshold', () => {
    expect(isSevereWeather('STORM', 2)).toBe(false)
  })

  it('SNOW at severity 3 is severe; at 2 it is not', () => {
    expect(isSevereWeather('SNOW', 3)).toBe(true)
    expect(isSevereWeather('SNOW', 2)).toBe(false)
  })

  it('a non-severe condition is never severe, even at max severity', () => {
    expect(isSevereWeather('RAIN', 5)).toBe(false)
    expect(isSevereWeather('CLEAR', 3)).toBe(false)
    expect(isSevereWeather('FOG', 5)).toBe(false)
  })
})
