// src/lib/game/__tests__/zones.test.ts
//
// Abstract range bands (#2, #43, #85). The old ZoneManager returned an
// { hasAdvantage, description } object nothing consumed; these tests pin
// down the thing that replaced it — a number that lands in the roll — plus
// the scene-scoping rule, which is the only non-obvious part.

import { describe, it, expect } from 'vitest'
import {
  ZONE_ORDER,
  DEFAULT_ZONE,
  rangeModifier,
  zoneDistance,
  parseZone,
  isZonePosition,
  isEngagement,
  describeZone,
  resolveZoneForScene,
  type ZonePosition,
} from '../zones'

describe('rangeModifier', () => {
  it('rewards melee for closing and punishes it for standing off', () => {
    expect(rangeModifier('close', 'melee')).toBe(1)
    expect(rangeModifier('near', 'melee')).toBe(0)
    expect(rangeModifier('far', 'melee')).toBeLessThan(0)
    // Swinging at someone across the plaza should cost more than bad weather.
    expect(rangeModifier('distant', 'melee')).toBeLessThan(rangeModifier('far', 'melee'))
  })

  it('gives ranged a middle band and penalizes both extremes', () => {
    // The whole point of the ranged row: being crowded is bad for a bow,
    // which is the one case a naive "closer is better" model gets wrong.
    expect(rangeModifier('close', 'ranged')).toBeLessThan(0)
    expect(rangeModifier('near', 'ranged')).toBeGreaterThan(0)
    expect(rangeModifier('far', 'ranged')).toBeGreaterThan(0)
    expect(rangeModifier('distant', 'ranged')).toBeLessThan(0)
  })

  it('treats social like melee — a conversation needs presence', () => {
    for (const zone of ZONE_ORDER) {
      expect(rangeModifier(zone, 'social')).toBe(rangeModifier(zone, 'melee'))
    }
  })

  it('leaves an action with no reach unmodified from every band', () => {
    // Most actions are this: bracing a door, searching a room, holding
    // your nerve. Position must not silently tax them.
    for (const zone of ZONE_ORDER) {
      expect(rangeModifier(zone, null)).toBe(0)
    }
  })

  it('never penalizes anything from the default band', () => {
    // A character whose position was never established should not be
    // handed a penalty by accident. Ranged is the one that gains from it,
    // and that is the band's actual meaning, not an oversight.
    expect(rangeModifier(DEFAULT_ZONE, 'melee')).toBe(0)
    expect(rangeModifier(DEFAULT_ZONE, 'social')).toBe(0)
    expect(rangeModifier(DEFAULT_ZONE, 'ranged')).toBe(1)
  })

  it('stays inside the existing modifier scale used elsewhere', () => {
    for (const zone of ZONE_ORDER) {
      for (const engagement of ['melee', 'ranged', 'social', null] as const) {
        const mod = rangeModifier(zone, engagement)
        expect(mod).toBeGreaterThanOrEqual(-2)
        expect(mod).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('zoneDistance', () => {
  it('counts bands apart, symmetrically', () => {
    expect(zoneDistance('close', 'close')).toBe(0)
    expect(zoneDistance('close', 'near')).toBe(1)
    expect(zoneDistance('close', 'distant')).toBe(3)
    expect(zoneDistance('distant', 'close')).toBe(3)
  })
})

describe('parseZone / guards', () => {
  it('accepts every real band', () => {
    for (const zone of ZONE_ORDER) {
      expect(isZonePosition(zone)).toBe(true)
      expect(parseZone(zone)).toBe(zone)
    }
  })

  it('falls back to the default rather than throwing on junk', () => {
    // These values come out of a JSON column and off an AI response.
    expect(parseZone(null)).toBe(DEFAULT_ZONE)
    expect(parseZone(undefined)).toBe(DEFAULT_ZONE)
    expect(parseZone('CLOSE')).toBe(DEFAULT_ZONE)
    expect(parseZone(3)).toBe(DEFAULT_ZONE)
    expect(parseZone({ zone: 'close' })).toBe(DEFAULT_ZONE)
  })

  it('recognizes only the three real engagements', () => {
    expect(isEngagement('melee')).toBe(true)
    expect(isEngagement('ranged')).toBe(true)
    expect(isEngagement('social')).toBe(true)
    expect(isEngagement(null)).toBe(false)
    expect(isEngagement('none')).toBe(false)
    expect(isEngagement('MELEE')).toBe(false)
  })

  it('gives every band in-fiction phrasing', () => {
    for (const zone of ZONE_ORDER) {
      expect(describeZone(zone).length).toBeGreaterThan(0)
      // Never leaks the mechanical band name into prose.
      expect(describeZone(zone)).not.toContain(zone)
    }
  })
})

describe('resolveZoneForScene', () => {
  it('carries a position forward within the same scene', () => {
    expect(resolveZoneForScene({
      storedZone: 'close',
      storedMetadata: { sceneId: 's1' },
      sceneId: 's1',
    })).toBe('close')
  })

  it('discards a position stored under a different scene', () => {
    // You don't start the next confrontation still pressed against the
    // same doorway. This is what scopes positions without needing a hook
    // in scene creation.
    expect(resolveZoneForScene({
      storedZone: 'close',
      storedMetadata: { sceneId: 's0' },
      sceneId: 's1',
    })).toBe(DEFAULT_ZONE)
  })

  it('discards a position with no scene recorded at all', () => {
    // Covers rows written before zoneMetadata existed.
    expect(resolveZoneForScene({ storedZone: 'distant', storedMetadata: null, sceneId: 's1' }))
      .toBe(DEFAULT_ZONE)
    expect(resolveZoneForScene({ storedZone: 'distant', storedMetadata: {}, sceneId: 's1' }))
      .toBe(DEFAULT_ZONE)
  })

  it('lets an explicit reposition beat both the stored zone and the scene check', () => {
    expect(resolveZoneForScene({
      storedZone: 'distant',
      storedMetadata: { sceneId: 's1' },
      sceneId: 's1',
      movesTo: 'close',
    })).toBe('close')

    // Even a stale stored position doesn't stop an explicit move.
    expect(resolveZoneForScene({
      storedZone: 'distant',
      storedMetadata: { sceneId: 'other' },
      sceneId: 's1',
      movesTo: 'far',
    })).toBe('far')
  })

  it('ignores a malformed reposition instead of trusting it', () => {
    expect(resolveZoneForScene({
      storedZone: 'close',
      storedMetadata: { sceneId: 's1' },
      sceneId: 's1',
      movesTo: 'adjacent',
    })).toBe('close')
  })

  it('resolves to the default when the caller tracks no scene', () => {
    // computeMechanics called without a sceneId: every character rolls
    // from the band that modifies nothing, which is the correct
    // degradation rather than a silent bonus.
    const zones: ZonePosition[] = ['close', 'near', 'far', 'distant']
    for (const stored of zones) {
      expect(resolveZoneForScene({
        storedZone: stored,
        storedMetadata: { sceneId: 's1' },
        sceneId: '',
      })).toBe(DEFAULT_ZONE)
    }
  })
})
