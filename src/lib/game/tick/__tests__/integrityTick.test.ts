import { describe, it, expect, vi, beforeEach } from 'vitest'

const runIntegrityPass = vi.hoisted(() => vi.fn())
const persistIntegrityReport = vi.hoisted(() => vi.fn())
vi.mock('../../integrity/runIntegrityPass', () => ({ runIntegrityPass }))
vi.mock('../../integrity/persistReport', () => ({ persistIntegrityReport }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { tickIntegrity } from '../integrityTick'
import type { TickContext } from '../types'
import { simTurn } from '@/lib/game/turnClock'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'camp1', turnNumber: simTurn(5), factionCap: 10, npcCap: 20, dryRun: false, db: {} as any, ...overrides }
}

beforeEach(() => vi.clearAllMocks())

describe('tickIntegrity', () => {
  it('returns the changes from runIntegrityPass, threading campaignId/turnNumber/dryRun through', async () => {
    runIntegrityPass.mockResolvedValue({
      changes: [{ entityType: 'CHARACTER', field: 'relationships' }],
      report: { violationsFound: 1, repairsApplied: 1, unrepaired: [], escalations: [] },
    })

    const result = await tickIntegrity(baseCtx({ campaignId: 'camp1', turnNumber: simTurn(9), dryRun: true }))

    expect(runIntegrityPass).toHaveBeenCalledWith(expect.anything(), 'camp1', 9, { dryRun: true })
    expect(result.changes).toHaveLength(1)
  })

  it('returns an empty changes array on a clean pass', async () => {
    runIntegrityPass.mockResolvedValue({
      changes: [],
      report: { violationsFound: 0, repairsApplied: 0, unrepaired: [], escalations: [] },
    })
    const result = await tickIntegrity(baseCtx())
    expect(result.changes).toEqual([])
  })

  it('mentions the escalation count in its summary log line when there is one', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    runIntegrityPass.mockResolvedValue({
      changes: [],
      report: {
        violationsFound: 2, repairsApplied: 2, unrepaired: [],
        escalations: [{ checkKey: 'x', kind: 'recurring-entity', entityIds: ['e1'], turnNumbers: [1, 2], occurrences: 2, sample: {} }],
      },
    })

    await tickIntegrity(baseCtx())

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 escalation(s)'))
    logSpy.mockRestore()
  })

  it('persists the report on a real pass', async () => {
    const report = { violationsFound: 0, repairsApplied: 0, unrepaired: [], escalations: [] }
    runIntegrityPass.mockResolvedValue({ changes: [], report })

    await tickIntegrity(baseCtx({ dryRun: false }))

    expect(persistIntegrityReport).toHaveBeenCalledWith(expect.anything(), report)
  })

  it('does not persist on a dry run — it never actually applied anything', async () => {
    runIntegrityPass.mockResolvedValue({
      changes: [],
      report: { violationsFound: 0, repairsApplied: 0, unrepaired: [], escalations: [] },
    })

    await tickIntegrity(baseCtx({ dryRun: true }))

    expect(persistIntegrityReport).not.toHaveBeenCalled()
  })
})
