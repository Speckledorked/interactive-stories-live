import { describe, it, expect } from 'vitest'
import { findRegression, REGRESSION_MONITORING_DAYS, MergedAutofixRecord } from '../regressionDetection'

const merge = (over: Partial<MergedAutofixRecord> = {}): MergedAutofixRecord => ({
  checkKey: 'character.relationships.keys.resolve',
  mergedAt: new Date().toISOString(),
  prNumber: 1,
  commitSha: 'abc123',
  ...over,
})

describe('findRegression', () => {
  it('returns null when there are no merges at all', () => {
    expect(findRegression('character.relationships.keys.resolve', [])).toBeNull()
  })

  it('returns null when merges exist but for a different checkKey', () => {
    const merges = [merge({ checkKey: 'war.contestedLocationId.resolves' })]
    expect(findRegression('character.relationships.keys.resolve', merges)).toBeNull()
  })

  it('flags a regression when a merge for this checkKey is within the monitoring window', () => {
    const now = new Date('2026-07-29T00:00:00Z')
    const merges = [merge({ mergedAt: '2026-07-20T00:00:00Z', prNumber: 42, commitSha: 'sha1' })]
    const result = findRegression('character.relationships.keys.resolve', merges, now)
    expect(result).toMatchObject({ prNumber: 42, commitSha: 'sha1' })
  })

  it('does not flag a merge older than the monitoring window as a regression', () => {
    const now = new Date('2026-07-29T00:00:00Z')
    const tooOld = new Date(now.getTime() - (REGRESSION_MONITORING_DAYS + 1) * 24 * 60 * 60 * 1000)
    const merges = [merge({ mergedAt: tooOld.toISOString() })]
    expect(findRegression('character.relationships.keys.resolve', merges, now)).toBeNull()
  })

  it('treats a merge exactly at the edge of the window as still in-window', () => {
    const now = new Date('2026-07-29T00:00:00Z')
    const edge = new Date(now.getTime() - REGRESSION_MONITORING_DAYS * 24 * 60 * 60 * 1000)
    const merges = [merge({ mergedAt: edge.toISOString() })]
    expect(findRegression('character.relationships.keys.resolve', merges, now)).not.toBeNull()
  })

  it('picks the MOST RECENT merge when several exist for the same checkKey', () => {
    const now = new Date('2026-07-29T00:00:00Z')
    const merges = [
      merge({ mergedAt: '2026-07-18T00:00:00Z', prNumber: 10, commitSha: 'old' }),
      merge({ mergedAt: '2026-07-25T00:00:00Z', prNumber: 20, commitSha: 'newest' }),
      merge({ mergedAt: '2026-07-22T00:00:00Z', prNumber: 15, commitSha: 'middle' }),
    ]
    const result = findRegression('character.relationships.keys.resolve', merges, now)
    expect(result?.commitSha).toBe('newest')
  })

  it('ignores merges for other checkKeys even when interleaved with the real one', () => {
    const now = new Date('2026-07-29T00:00:00Z')
    const merges = [
      merge({ checkKey: 'war.contestedLocationId.resolves', mergedAt: '2026-07-27T00:00:00Z', commitSha: 'wrong-key' }),
      merge({ checkKey: 'character.relationships.keys.resolve', mergedAt: '2026-07-20T00:00:00Z', commitSha: 'right-key' }),
    ]
    const result = findRegression('character.relationships.keys.resolve', merges, now)
    expect(result?.commitSha).toBe('right-key')
  })
})
