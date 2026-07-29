import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findActionableEscalations, ESCALATION_LOOKBACK_DAYS } from '../escalationAggregation'
import type { Escalation, IntegrityReport } from '../types'

const db = () => ({
  worldMeta: { findMany: vi.fn(async (): Promise<any[]> => []) },
})

const escalation = (over: Partial<Escalation> = {}): Escalation => ({
  checkKey: 'character.relationships.keys.resolve',
  kind: 'recurring-entity',
  entityIds: ['char1'],
  turnNumbers: [5, 6],
  occurrences: 2,
  sample: {
    checkKey: 'character.relationships.keys.resolve',
    entityType: 'CHARACTER',
    entityId: 'char1',
    entityName: 'Jason',
    description: 'orphan key',
  },
  ...over,
})

const report = (over: Partial<IntegrityReport> = {}): IntegrityReport => ({
  campaignId: 'camp1',
  turnNumber: 5,
  timestamp: new Date().toISOString(),
  violationsFound: 1,
  repairsApplied: 1,
  unrepaired: [],
  escalations: [],
  perCheckMs: {},
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('findActionableEscalations', () => {
  it('returns nothing when no campaign has any escalations', async () => {
    const tx = db()
    tx.worldMeta.findMany.mockResolvedValue([
      { campaignId: 'camp1', integrityReportHistory: [report({ escalations: [] })] },
    ])
    expect(await findActionableEscalations(tx as any)).toEqual([])
  })

  it('surfaces an escalation whose checkKey has an attributed source', async () => {
    const tx = db()
    tx.worldMeta.findMany.mockResolvedValue([
      { campaignId: 'camp1', integrityReportHistory: [report({ escalations: [escalation()] })] },
    ])
    const result = await findActionableEscalations(tx as any)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      checkKey: 'character.relationships.keys.resolve',
      campaignIds: ['camp1'],
      totalOccurrences: 2,
      oracleTechnique: 'property',
      autoMergeEligible: true,
    })
    expect(result[0].sourceFiles).toContain('src/lib/game/worldUpdaters/characters.ts')
  })

  it('drops an escalation whose checkKey has no attributed source — nowhere to start a fix', async () => {
    const tx = db()
    tx.worldMeta.findMany.mockResolvedValue([
      {
        campaignId: 'camp1',
        integrityReportHistory: [report({ escalations: [escalation({ checkKey: 'debt.counterpartyId.resolves' })] })],
      },
    ])
    expect(await findActionableEscalations(tx as any)).toEqual([])
  })

  it('aggregates the same checkKey across multiple campaigns into one entry', async () => {
    const tx = db()
    tx.worldMeta.findMany.mockResolvedValue([
      { campaignId: 'camp1', integrityReportHistory: [report({ campaignId: 'camp1', escalations: [escalation({ occurrences: 2 })] })] },
      { campaignId: 'camp2', integrityReportHistory: [report({ campaignId: 'camp2', escalations: [escalation({ occurrences: 3 })] })] },
    ])
    const result = await findActionableEscalations(tx as any)
    expect(result).toHaveLength(1)
    expect(result[0].campaignIds.sort()).toEqual(['camp1', 'camp2'])
    expect(result[0].totalOccurrences).toBe(5)
  })

  it('does not double-count the same campaign appearing twice in its own history', async () => {
    const tx = db()
    tx.worldMeta.findMany.mockResolvedValue([
      {
        campaignId: 'camp1',
        integrityReportHistory: [
          report({ turnNumber: 5, escalations: [escalation({ occurrences: 2 })] }),
          report({ turnNumber: 6, escalations: [escalation({ occurrences: 2 })] }),
        ],
      },
    ])
    const result = await findActionableEscalations(tx as any)
    expect(result[0].campaignIds).toEqual(['camp1'])
    // Occurrences still sum across both history entries — that's real signal.
    expect(result[0].totalOccurrences).toBe(4)
  })

  it('keeps two different checkKeys as separate entries', async () => {
    const tx = db()
    tx.worldMeta.findMany.mockResolvedValue([
      {
        campaignId: 'camp1',
        integrityReportHistory: [
          report({
            escalations: [
              escalation({ checkKey: 'character.relationships.keys.resolve' }),
              escalation({ checkKey: 'war.contestedLocationId.resolves', sample: { ...escalation().sample, checkKey: 'war.contestedLocationId.resolves', entityType: 'WAR' } }),
            ],
          }),
        ],
      },
    ])
    const result = await findActionableEscalations(tx as any)
    expect(result.map((r) => r.checkKey).sort()).toEqual([
      'character.relationships.keys.resolve',
      'war.contestedLocationId.resolves',
    ])
  })

  it('queries only campaigns whose last integrity check falls within the lookback window', async () => {
    const tx = db()
    tx.worldMeta.findMany.mockResolvedValue([])
    await findActionableEscalations(tx as any)
    const call = (tx.worldMeta.findMany.mock.calls[0] as any[])[0]
    const gte: Date = call.where.lastIntegrityCheck.gte
    const expectedMs = ESCALATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    expect(Date.now() - gte.getTime()).toBeGreaterThanOrEqual(expectedMs - 5000)
    expect(Date.now() - gte.getTime()).toBeLessThanOrEqual(expectedMs + 5000)
  })

  it('treats a non-array integrityReportHistory as empty rather than throwing', async () => {
    const tx = db()
    tx.worldMeta.findMany.mockResolvedValue([{ campaignId: 'camp1', integrityReportHistory: null }])
    expect(await findActionableEscalations(tx as any)).toEqual([])
  })
})
