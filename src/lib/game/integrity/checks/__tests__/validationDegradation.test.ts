import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  detectValidationDegradation,
  VALIDATION_DEGRADATION_WINDOW,
  VALIDATION_DEGRADATION_RATE_THRESHOLD,
} from '../validationDegradation'

function entry(validationLevel: string | undefined, requestType = 'scene_resolution') {
  return { requestType, validationLevel }
}

describe('detectValidationDegradation', () => {
  it('returns null when requestHistory is not an array', () => {
    expect(detectValidationDegradation(undefined)).toBeNull()
    expect(detectValidationDegradation(null)).toBeNull()
    expect(detectValidationDegradation('not an array')).toBeNull()
  })

  it('returns null when there are fewer scene_resolution entries than the window', () => {
    const history = Array.from({ length: VALIDATION_DEGRADATION_WINDOW - 1 }, () => entry('full'))
    expect(detectValidationDegradation(history)).toBeNull()
  })

  it('ignores non-scene_resolution entries when counting toward the window', () => {
    const history = [
      ...Array.from({ length: VALIDATION_DEGRADATION_WINDOW - 1 }, () => entry('full')),
      entry('emergency', 'world_turn'), // wrong requestType — doesn't count
    ]
    expect(detectValidationDegradation(history)).toBeNull()
  })

  it('reports not degraded when the whole window is full validation', () => {
    const history = Array.from({ length: VALIDATION_DEGRADATION_WINDOW }, () => entry('full'))
    const result = detectValidationDegradation(history)
    expect(result).toEqual({
      window: VALIDATION_DEGRADATION_WINDOW,
      sampleSize: VALIDATION_DEGRADATION_WINDOW,
      degradedCount: 0,
      rate: 0,
      degraded: false,
    })
  })

  it('reports degraded once the rate exceeds the threshold', () => {
    // 4/10 = 0.4 > 0.3 threshold
    const history = [
      ...Array.from({ length: 4 }, () => entry('partial')),
      ...Array.from({ length: 6 }, () => entry('full')),
    ]
    const result = detectValidationDegradation(history)
    expect(result).toEqual({
      window: VALIDATION_DEGRADATION_WINDOW,
      sampleSize: 10,
      degradedCount: 4,
      rate: 0.4,
      degraded: true,
    })
  })

  it('does not flag exactly at the threshold — it must exceed, not just meet, it', () => {
    // 3/10 = 0.3, equal to the threshold — not degraded
    const history = [
      ...Array.from({ length: 3 }, () => entry('emergency')),
      ...Array.from({ length: 7 }, () => entry('full')),
    ]
    expect(detectValidationDegradation(history)?.degraded).toBe(false)
  })

  it('treats a missing validationLevel as degraded, not full', () => {
    const history = [
      entry(undefined),
      ...Array.from({ length: VALIDATION_DEGRADATION_WINDOW - 1 }, () => entry('full')),
    ]
    expect(detectValidationDegradation(history)?.degradedCount).toBe(1)
  })

  it('only judges the most recent window, not the whole history', () => {
    // 40 degraded entries buried earlier, then a clean recent window
    const history = [
      ...Array.from({ length: 40 }, () => entry('emergency')),
      ...Array.from({ length: VALIDATION_DEGRADATION_WINDOW }, () => entry('full')),
    ]
    const result = detectValidationDegradation(history)
    expect(result?.degraded).toBe(false)
    expect(result?.sampleSize).toBe(VALIDATION_DEGRADATION_WINDOW)
  })
})

describe('detectValidationDegradation — rate/degraded invariant (property)', () => {
  it('rate always equals degradedCount/sampleSize, and degraded always matches the threshold comparison', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            requestType: fc.constant('scene_resolution'),
            validationLevel: fc.constantFrom('full', 'partial', 'emergency', undefined),
          }),
          { minLength: VALIDATION_DEGRADATION_WINDOW, maxLength: 60 }
        ),
        (history) => {
          const result = detectValidationDegradation(history)
          expect(result).not.toBeNull()
          expect(result!.rate).toBeCloseTo(result!.degradedCount / result!.sampleSize)
          expect(result!.degraded).toBe(result!.rate > VALIDATION_DEGRADATION_RATE_THRESHOLD)
        }
      )
    )
  })
})
