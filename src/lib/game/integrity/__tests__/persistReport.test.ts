import { describe, it, expect, vi, beforeEach } from 'vitest'
import { persistIntegrityReport } from '../persistReport'
import type { IntegrityReport } from '../types'

const db = () => ({
  worldMeta: {
    findUnique: vi.fn(async (): Promise<any> => ({ id: 'wm1', integrityReportHistory: null })),
    update: vi.fn(async () => ({})),
  },
})

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
})
