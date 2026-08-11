import { describe, it, expect } from 'vitest'
import { decideStressDrift, classifyStressEvents, MAX_STRESS, STRESS_EVOLUTION_THRESHOLD } from '../stress'

describe('decideStressDrift', () => {
  it('decays by 1 when no events fired this exchange', () => {
    expect(decideStressDrift(5, [])).toBe(4)
  })

  it('never decays below 0', () => {
    expect(decideStressDrift(0, [])).toBe(0)
  })

  it('raises by 1 per ordinary event', () => {
    expect(decideStressDrift(0, [{ kind: 'MISS_TAKEN' }])).toBe(1)
    expect(decideStressDrift(0, [{ kind: 'CONSEQUENCE_COST' }])).toBe(1)
    expect(decideStressDrift(0, [{ kind: 'CORRUPTION_MARK' }])).toBe(1)
  })

  it('HARM_TAKEN counts double', () => {
    expect(decideStressDrift(0, [{ kind: 'HARM_TAKEN' }])).toBe(2)
  })

  it('folds multiple events in the same exchange, each additive', () => {
    expect(decideStressDrift(0, [{ kind: 'MISS_TAKEN' }, { kind: 'HARM_TAKEN' }])).toBe(3)
  })

  it('never exceeds MAX_STRESS no matter how many events pile up', () => {
    const many = Array.from({ length: 20 }, () => ({ kind: 'HARM_TAKEN' as const }))
    expect(decideStressDrift(0, many)).toBe(MAX_STRESS)
  })

  it('a quiet exchange after a raise brings stress back down one step', () => {
    const raised = decideStressDrift(0, [{ kind: 'MISS_TAKEN' }])
    expect(decideStressDrift(raised, [])).toBe(0)
  })
})

describe('classifyStressEvents', () => {
  it('returns nothing for a quiet exchange', () => {
    expect(classifyStressEvents({})).toEqual([])
  })

  it('classifies a miss', () => {
    expect(classifyStressEvents({ outcome: 'miss' })).toEqual([{ kind: 'MISS_TAKEN' }])
  })

  it('does not classify a strongHit or weakHit as a stress event', () => {
    expect(classifyStressEvents({ outcome: 'strongHit' })).toEqual([])
    expect(classifyStressEvents({ outcome: 'weakHit' })).toEqual([])
  })

  it('classifies harm at or above the serious threshold, not a graze', () => {
    expect(classifyStressEvents({ harmDamage: 1 })).toEqual([])
    expect(classifyStressEvents({ harmDamage: 2 })).toEqual([{ kind: 'HARM_TAKEN' }])
  })

  it('classifies a costly consequence (enemy/longTermThreat) but not a promise or debt', () => {
    expect(classifyStressEvents({ consequenceTypesAdded: ['promise'] })).toEqual([])
    expect(classifyStressEvents({ consequenceTypesAdded: ['debt'] })).toEqual([])
    expect(classifyStressEvents({ consequenceTypesAdded: ['enemy'] })).toEqual([{ kind: 'CONSEQUENCE_COST' }])
    expect(classifyStressEvents({ consequenceTypesAdded: ['longTermThreat'] })).toEqual([{ kind: 'CONSEQUENCE_COST' }])
  })

  it('a mixed batch of consequence types still fires exactly one CONSEQUENCE_COST event', () => {
    expect(classifyStressEvents({ consequenceTypesAdded: ['promise', 'enemy', 'debt'] })).toEqual([{ kind: 'CONSEQUENCE_COST' }])
  })

  it('classifies an applied corruption mark', () => {
    expect(classifyStressEvents({ gainedCorruptionMark: true })).toEqual([{ kind: 'CORRUPTION_MARK' }])
    expect(classifyStressEvents({ gainedCorruptionMark: false })).toEqual([])
  })

  it('classifies every real signal in the same exchange', () => {
    const events = classifyStressEvents({
      outcome: 'miss',
      harmDamage: 3,
      consequenceTypesAdded: ['enemy'],
      gainedCorruptionMark: true,
    })
    expect(events.map((e) => e.kind).sort()).toEqual(['CONSEQUENCE_COST', 'CORRUPTION_MARK', 'HARM_TAKEN', 'MISS_TAKEN'])
  })
})

describe('STRESS_EVOLUTION_THRESHOLD', () => {
  it('sits comfortably above neutral, requiring real repeated pressure', () => {
    expect(STRESS_EVOLUTION_THRESHOLD).toBeGreaterThan(MAX_STRESS / 2)
    expect(STRESS_EVOLUTION_THRESHOLD).toBeLessThanOrEqual(MAX_STRESS)
  })
})
