// src/lib/game/__tests__/pacing.test.ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WORLD_TURN_HOURS,
  resolveWorldTurnHours,
  elapsedInGameHours,
  decideWorldTurnPacing,
} from '../tick/pacing'

describe('resolveWorldTurnHours', () => {
  it('falls back to the default for null meta, null setting, and non-positive values', () => {
    expect(resolveWorldTurnHours(null)).toBe(DEFAULT_WORLD_TURN_HOURS)
    expect(resolveWorldTurnHours({ worldTurnHours: null })).toBe(DEFAULT_WORLD_TURN_HOURS)
    expect(resolveWorldTurnHours({ worldTurnHours: 0 })).toBe(DEFAULT_WORLD_TURN_HOURS)
    expect(resolveWorldTurnHours({ worldTurnHours: -5 })).toBe(DEFAULT_WORLD_TURN_HOURS)
  })

  it('uses a configured positive value', () => {
    expect(resolveWorldTurnHours({ worldTurnHours: 48 })).toBe(48)
  })
})

describe('elapsedInGameHours', () => {
  it('handles missing/empty time passage', () => {
    expect(elapsedInGameHours(undefined)).toBe(0)
    expect(elapsedInGameHours(null)).toBe(0)
    expect(elapsedInGameHours({})).toBe(0)
  })

  it('combines days and hours', () => {
    expect(elapsedInGameHours({ days: 1, hours: 6 })).toBe(30)
    expect(elapsedInGameHours({ hours: 3 })).toBe(3)
    expect(elapsedInGameHours({ days: 2 })).toBe(48)
  })

  it('never returns negative and ignores non-numeric junk', () => {
    expect(elapsedInGameHours({ days: -1 })).toBe(0)
    expect(elapsedInGameHours({ days: 'soon' as any, hours: 2 })).toBe(2)
  })
})

describe('decideWorldTurnPacing', () => {
  it('waits below the threshold, preserving the accumulator', () => {
    expect(decideWorldTurnPacing(0, 24)).toEqual({ shouldRun: false, remainingHours: 0 })
    expect(decideWorldTurnPacing(23.5, 24)).toEqual({ shouldRun: false, remainingHours: 23.5 })
  })

  it('runs at exactly the threshold and resets to zero', () => {
    expect(decideWorldTurnPacing(24, 24)).toEqual({ shouldRun: true, remainingHours: 0 })
  })

  it('carries modest overflow forward', () => {
    expect(decideWorldTurnPacing(30, 24)).toEqual({ shouldRun: true, remainingHours: 6 })
  })

  it('caps banked overflow at one threshold so a long timeskip cannot machine-gun ticks', () => {
    // A three-week timeskip: run now, bank exactly one more day's worth.
    expect(decideWorldTurnPacing(21 * 24, 24)).toEqual({ shouldRun: true, remainingHours: 24 })
  })
})
