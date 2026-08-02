import { describe, it, expect } from 'vitest'
import { decideArcDelta, applyArcDelta, decideArcResolution, ARC_VALUE_MIN, ARC_VALUE_MAX } from '../arc'

describe('decideArcDelta (#119)', () => {
  it('is deterministic for the same arc id and turn number', () => {
    const a = decideArcDelta('arc-1', 5, { sideAStrength: 60, sideBStrength: 40 })
    const b = decideArcDelta('arc-1', 5, { sideAStrength: 60, sideBStrength: 40 })
    expect(a).toBe(b)
  })

  it('produces a different delta for a different turn number, same sides', () => {
    const deltas = new Set(
      Array.from({ length: 10 }, (_, i) => decideArcDelta('arc-1', i, { sideAStrength: 50, sideBStrength: 50 }))
    )
    expect(deltas.size).toBeGreaterThan(1)
  })

  it('never exceeds the default max swing per tick in either direction', () => {
    const deltas = Array.from({ length: 30 }, (_, i) => decideArcDelta('arc-1', i, { sideAStrength: 100, sideBStrength: 0 }))
    for (const d of deltas) {
      expect(d).toBeGreaterThanOrEqual(-20)
      expect(d).toBeLessThanOrEqual(20)
    }
  })

  it('respects custom edgeWeight/maxSwingPerTick/varianceSpread options', () => {
    const delta = decideArcDelta('arc-1', 5, { sideAStrength: 100, sideBStrength: 0 }, { edgeWeight: 0, maxSwingPerTick: 3, varianceSpread: 3 })
    expect(delta).toBeGreaterThanOrEqual(-3)
    expect(delta).toBeLessThanOrEqual(3)
  })

  it('matches the exact War.momentum formula with default options (edge*0.2, +/-10 variance, clamp +/-20)', () => {
    // Reproduces the original inline formula from warTick.ts byte-for-byte
    // to confirm decideArcDelta is a faithful extraction, not a rewrite.
    function stableHash(input: string): number {
      let hash = 0
      for (let i = 0; i < input.length; i++) hash = (hash * 31 + input.charCodeAt(i)) | 0
      return Math.abs(hash)
    }
    const militaryEdge = 60 - 40
    const variance = (stableHash('war-1:7') % 21) - 10
    const expected = Math.max(-20, Math.min(20, Math.round(militaryEdge * 0.2) + variance))
    expect(decideArcDelta('war-1', 7, { sideAStrength: 60, sideBStrength: 40 })).toBe(expected)
  })
})

describe('applyArcDelta (#119)', () => {
  it('adds the delta to the current value', () => {
    expect(applyArcDelta(0, 15)).toBe(15)
    expect(applyArcDelta(10, -5)).toBe(5)
  })

  it('clamps to the default -100..100 range', () => {
    expect(applyArcDelta(95, 20)).toBe(ARC_VALUE_MAX)
    expect(applyArcDelta(-95, -20)).toBe(ARC_VALUE_MIN)
  })

  it('respects a custom range', () => {
    expect(applyArcDelta(8, 5, 0, 10)).toBe(10)
    expect(applyArcDelta(2, -5, 0, 10)).toBe(0)
  })
})

describe('decideArcResolution (#119)', () => {
  it('resolves in favor of side A once past the decisive threshold', () => {
    expect(decideArcResolution(65, 1, 60, 10)).toEqual({ resolves: true, winner: 'A' })
  })

  it('resolves in favor of side B once past the decisive threshold in the negative direction', () => {
    expect(decideArcResolution(-65, 1, 60, 10)).toEqual({ resolves: true, winner: 'B' })
  })

  it('resolves as a stalemate on timeout when neither side broke through', () => {
    expect(decideArcResolution(10, 10, 60, 10)).toEqual({ resolves: true, winner: 'stalemate' })
  })

  it('does not resolve while under threshold and still within the duration', () => {
    expect(decideArcResolution(30, 5, 60, 10)).toEqual({ resolves: false, winner: null })
  })

  it('checks the decisive threshold before the timeout', () => {
    // Both conditions true simultaneously — decisive should win, not stalemate.
    expect(decideArcResolution(70, 15, 60, 10)).toEqual({ resolves: true, winner: 'A' })
  })

  it('matches decideWarResolution\'s exact behavior at the war thresholds (60 decisive, 10 turns)', () => {
    expect(decideArcResolution(59, 9, 60, 10)).toEqual({ resolves: false, winner: null })
    expect(decideArcResolution(60, 9, 60, 10)).toEqual({ resolves: true, winner: 'A' })
    expect(decideArcResolution(0, 10, 60, 10)).toEqual({ resolves: true, winner: 'stalemate' })
  })
})
