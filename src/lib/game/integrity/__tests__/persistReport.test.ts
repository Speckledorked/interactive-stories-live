import { describe, it, expect, vi, beforeEach } from 'vitest'
import { persistIntegrityReport } from '../persistReport'
import type { IntegrityReport } from '../types'
import { VALIDATION_DEGRADATION_WINDOW } from '../checks/validationDegradation'

const db = () => ({
  worldMeta: {
    findUnique: vi.fn(async (): Promise<any> => ({ id: 'wm1', integrityReportHistory: null, aiMetrics: null })),
    update: vi.fn(async () => ({})),
  },
})

function sceneResolution(validationLevel: string) {
  return { requestType: 'scene_resolution', validationLevel }
}

const report = (over: Partial<IntegrityReport> = {}): IntegrityReport => ({
  campaignId: 'camp1',
  turnNumber: 5,
  timestamp: '2026-07-29T00:00:00.000Z',
  violationsFound: 0,
  repairsApplied: 0,
  unrepaired: [],
  escalations: [],
  perCheckMs: {},
  ...over,
})

describe('persistIntegrityReport', () => {
  it('appends the report and stamps lastIntegrityCheck', async () => {
    const tx = db()
    await persistIntegrityReport(tx as any, report())

    expect(tx.worldMeta.update).toHaveBeenCalledWith({
      where: { id: 'wm1' },
      data: {
        integrityReportHistory: [report()],
        lastIntegrityCheck: expect.any(Date),
      },
    })
  })

  it('appends onto existing history rather than overwriting it', async () => {
    const tx = db()
    tx.worldMeta.findUnique.mockResolvedValue({
      id: 'wm1',
      integrityReportHistory: [report({ turnNumber: 1 })],
    })

    await persistIntegrityReport(tx as any, report({ turnNumber: 2 }))

    const data = (tx.worldMeta.update as any).mock.calls[0][0].data
    expect(data.integrityReportHistory).toHaveLength(2)
    expect(data.integrityReportHistory[1].turnNumber).toBe(2)
  })

  it('keeps only the most recent 30 reports', async () => {
    const tx = db()
    const history = Array.from({ length: 30 }, (_, i) => report({ turnNumber: i }))
    tx.worldMeta.findUnique.mockResolvedValue({ id: 'wm1', integrityReportHistory: history })

    await persistIntegrityReport(tx as any, report({ turnNumber: 999 }))

    const data = (tx.worldMeta.update as any).mock.calls[0][0].data
    expect(data.integrityReportHistory).toHaveLength(30)
    expect(data.integrityReportHistory[29].turnNumber).toBe(999)
    expect(data.integrityReportHistory[0].turnNumber).toBe(1)
  })

  it('does nothing when the campaign has no WorldMeta row', async () => {
    const tx = db()
    tx.worldMeta.findUnique.mockResolvedValue(null)

    await persistIntegrityReport(tx as any, report())

    expect(tx.worldMeta.update).not.toHaveBeenCalled()
  })

  it('swallows a persistence error rather than throwing — this is a side channel, not the repair path', async () => {
    const tx = db()
    tx.worldMeta.update.mockRejectedValue(new Error('connection lost'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(persistIntegrityReport(tx as any, report())).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('leaves the report untouched when there is not yet a full window of scene-resolution history', async () => {
    const tx = db()
    tx.worldMeta.findUnique.mockResolvedValue({
      id: 'wm1',
      integrityReportHistory: null,
      aiMetrics: { requestHistory: [sceneResolution('full')] },
    })

    await persistIntegrityReport(tx as any, report())

    const data = (tx.worldMeta.update as any).mock.calls[0][0].data
    expect(data.integrityReportHistory[0]).toEqual(report())
    expect(data.integrityReportHistory[0].validationDegradation).toBeUndefined()
  })

  it('attaches validationDegradation to the persisted report once a full window is available', async () => {
    const tx = db()
    tx.worldMeta.findUnique.mockResolvedValue({
      id: 'wm1',
      integrityReportHistory: null,
      aiMetrics: {
        requestHistory: Array.from({ length: VALIDATION_DEGRADATION_WINDOW }, () => sceneResolution('full')),
      },
    })

    await persistIntegrityReport(tx as any, report())

    const data = (tx.worldMeta.update as any).mock.calls[0][0].data
    expect(data.integrityReportHistory[0].validationDegradation).toEqual({
      window: VALIDATION_DEGRADATION_WINDOW,
      sampleSize: VALIDATION_DEGRADATION_WINDOW,
      degradedCount: 0,
      rate: 0,
      degraded: false,
    })
  })

  it('logs an error when the degradation rate is over threshold', async () => {
    const tx = db()
    tx.worldMeta.findUnique.mockResolvedValue({
      id: 'wm1',
      integrityReportHistory: null,
      aiMetrics: {
        requestHistory: [
          ...Array.from({ length: 5 }, () => sceneResolution('emergency')),
          ...Array.from({ length: 5 }, () => sceneResolution('full')),
        ],
      },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await persistIntegrityReport(tx as any, report())

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('AI validation degrading'))
    errorSpy.mockRestore()
  })
})
