import { describe, it, expect } from 'vitest'
import { detectEscalations, IntegrityEventRecord } from '../escalation'
import { RECURRING_ENTITY_TURN_THRESHOLD, SYSTEMIC_ENTITY_COUNT_THRESHOLD } from '../caps'

function event(overrides: Partial<IntegrityEventRecord> = {}): IntegrityEventRecord {
  return {
    checkKey: 'character.relationships.keys.resolve',
    entityType: 'CHARACTER',
    entityId: 'char1',
    entityName: 'Jason',
    turnNumber: 1,
    description: 'test',
    ...overrides,
  }
}

describe('detectEscalations — a single, one-off repair', () => {
  it('is not an escalation at all', () => {
    expect(detectEscalations([event({ turnNumber: 5 })])).toHaveLength(0)
  })
})

describe('detectEscalations — recurring on one entity', () => {
  it('flags a checkKey that repairs the same entity across separate turns', () => {
    const events = Array.from({ length: RECURRING_ENTITY_TURN_THRESHOLD }, (_, i) =>
      event({ entityId: 'char1', turnNumber: i + 1 })
    )
    const escalations = detectEscalations(events)
    expect(escalations).toHaveLength(1)
    expect(escalations[0]).toMatchObject({
      checkKey: 'character.relationships.keys.resolve',
      kind: 'recurring-entity',
      entityIds: ['char1'],
      occurrences: RECURRING_ENTITY_TURN_THRESHOLD,
    })
  })

  it('does not flag an entity repaired more than once in a single turn (that is what the blast-radius cap already governs)', () => {
    const events = [event({ entityId: 'char1', turnNumber: 1 }), event({ entityId: 'char1', turnNumber: 1 })]
    expect(detectEscalations(events)).toHaveLength(0)
  })

  it('does not flag distinct entities that were each repaired only once', () => {
    const events = [event({ entityId: 'char1', turnNumber: 1 }), event({ entityId: 'char2', turnNumber: 2 })]
    // Below SYSTEMIC_ENTITY_COUNT_THRESHOLD too, so neither signal fires.
    expect(detectEscalations(events).filter((e) => e.kind === 'recurring-entity')).toHaveLength(0)
  })

  it('reports every distinct turn it fired on, sorted ascending', () => {
    const events = [
      event({ entityId: 'char1', turnNumber: 9 }),
      event({ entityId: 'char1', turnNumber: 3 }),
      event({ entityId: 'char1', turnNumber: 6 }),
    ]
    const [escalation] = detectEscalations(events)
    expect(escalation.turnNumbers).toEqual([3, 6, 9])
  })
})

describe('detectEscalations — systemic across many entities', () => {
  it('flags a checkKey firing on enough distinct entities, even once each', () => {
    const events = Array.from({ length: SYSTEMIC_ENTITY_COUNT_THRESHOLD }, (_, i) =>
      event({ entityId: `char${i}`, turnNumber: 1 })
    )
    const escalations = detectEscalations(events)
    expect(escalations).toHaveLength(1)
    expect(escalations[0]).toMatchObject({ kind: 'systemic', occurrences: SYSTEMIC_ENTITY_COUNT_THRESHOLD })
    expect(escalations[0].entityIds).toHaveLength(SYSTEMIC_ENTITY_COUNT_THRESHOLD)
  })

  it('does not flag fewer distinct entities than the threshold', () => {
    const events = Array.from({ length: SYSTEMIC_ENTITY_COUNT_THRESHOLD - 1 }, (_, i) =>
      event({ entityId: `char${i}`, turnNumber: 1 })
    )
    expect(detectEscalations(events).filter((e) => e.kind === 'systemic')).toHaveLength(0)
  })
})

describe('detectEscalations — both readings can fire from the same data', () => {
  it('reports recurring-entity AND systemic separately when both thresholds are met', () => {
    // char1 recurs across turns; overall entity count also crosses the
    // systemic threshold. Both are real, different findings about the same
    // checkKey and should not collapse into one.
    const events = [
      ...Array.from({ length: RECURRING_ENTITY_TURN_THRESHOLD }, (_, i) => event({ entityId: 'char1', turnNumber: i + 1 })),
      ...Array.from({ length: SYSTEMIC_ENTITY_COUNT_THRESHOLD - 1 }, (_, i) => event({ entityId: `other${i}`, turnNumber: 1 })),
    ]
    const escalations = detectEscalations(events)
    expect(escalations.some((e) => e.kind === 'recurring-entity')).toBe(true)
    expect(escalations.some((e) => e.kind === 'systemic')).toBe(true)
  })
})

describe('detectEscalations — checkKey isolation', () => {
  it('never lets one checkKey\'s recurrence count toward a different checkKey\'s thresholds', () => {
    const events = [
      ...Array.from({ length: SYSTEMIC_ENTITY_COUNT_THRESHOLD }, (_, i) =>
        event({ checkKey: 'checkA', entityId: `a${i}`, turnNumber: 1 })
      ),
      event({ checkKey: 'checkB', entityId: 'b1', turnNumber: 1 }),
    ]
    const escalations = detectEscalations(events)
    expect(escalations.every((e) => e.checkKey === 'checkA')).toBe(true)
  })
})

describe('detectEscalations — the sample', () => {
  it('carries a full Violation-shaped sample from the most recent occurrence', () => {
    const events = [
      event({ entityId: 'char1', turnNumber: 1, entityName: 'Old Name', description: 'old' }),
      event({ entityId: 'char1', turnNumber: 2, entityName: 'Jason', description: 'newest occurrence' }),
    ]
    const [escalation] = detectEscalations(events)
    expect(escalation.sample.description).toBe('newest occurrence')
    expect(escalation.sample.entityName).toBe('Jason')
  })
})
