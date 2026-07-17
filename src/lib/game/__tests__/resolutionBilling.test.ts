// src/lib/game/__tests__/resolutionBilling.test.ts
// Metered per-scene billing: real AI cost (summed from AICostEntry) with a
// margin markup, not the flat per-tier guess this replaced.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    scene: { findUnique: vi.fn() },
    playerAction: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    aICostEntry: { aggregate: vi.fn() },
  },
}))
vi.mock('@/lib/payment/service', () => ({
  checkBalance: vi.fn(),
  deductFunds: vi.fn(),
  formatCurrency: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}))

import { prisma } from '@/lib/prisma'
import { checkBalance, deductFunds } from '@/lib/payment/service'
import { meteredChargeCents, preflightSceneBilling, chargeForSceneResolution } from '../resolutionBilling'

const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
})

describe('meteredChargeCents', () => {
  it('applies the margin multiplier', () => {
    expect(meteredChargeCents(10)).toBe(60) // 10 * 6
  })

  it('floors at the minimum charge for cheap scenes', () => {
    expect(meteredChargeCents(0.1)).toBe(5)
    expect(meteredChargeCents(0)).toBe(5)
  })

  it('rounds up fractional cents', () => {
    expect(meteredChargeCents(1.01)).toBe(7) // 1.01 * 6 = 6.06 -> 7
  })
})

describe('preflightSceneBilling', () => {
  it('estimates from cost-so-far plus a buffer and checks affordability', async () => {
    db.scene.findUnique.mockResolvedValue({
      currentExchange: 1,
      participants: { userIds: ['u1', 'u2'] },
    })
    db.aICostEntry.aggregate.mockResolvedValue({ _sum: { costMicros: 200_000 } }) // 20 cents raw
    db.user.findMany.mockResolvedValue([{ id: 'u1', name: 'A' }, { id: 'u2', name: 'B' }])
    ;(checkBalance as any).mockResolvedValue({ sufficient: true, currentBalance: 1000 })

    const result = await preflightSceneBilling('scene1')

    // raw 20c -> metered 120c -> +20c buffer = 140c / 2 players = 70c
    expect(result).toEqual({ ok: true, playerCount: 2, costPerPlayer: 70 })
    expect(deductFunds).not.toHaveBeenCalled() // preflight never charges
  })

  it('blocks when a payer cannot cover the estimate', async () => {
    db.scene.findUnique.mockResolvedValue({
      currentExchange: 1,
      participants: { userIds: ['poor'] },
    })
    db.aICostEntry.aggregate.mockResolvedValue({ _sum: { costMicros: 0 } })
    db.user.findMany.mockResolvedValue([{ id: 'poor', name: 'Poor' }])
    ;(checkBalance as any).mockResolvedValue({ sufficient: false, currentBalance: 0 })

    const result = await preflightSceneBilling('scene1')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Insufficient balance')
  })

  it('passes through with no charge when there is no one to bill', async () => {
    db.scene.findUnique.mockResolvedValue({ currentExchange: 1, participants: null })
    db.playerAction.findMany.mockResolvedValue([])

    const result = await preflightSceneBilling('scene1')

    expect(result).toEqual({ ok: true, playerCount: 0 })
  })
})

describe('chargeForSceneResolution', () => {
  it('charges the real metered total, split across participants', async () => {
    db.scene.findUnique.mockResolvedValue({
      sceneNumber: 3, currentExchange: 1, participants: { userIds: ['u1', 'u2'] },
    })
    db.aICostEntry.aggregate.mockResolvedValue({ _sum: { costMicros: 300_000 } }) // 30 cents raw
    db.user.findMany.mockResolvedValue([{ id: 'u1', name: 'A' }, { id: 'u2', name: 'B' }])
    ;(checkBalance as any).mockResolvedValue({ sufficient: true, currentBalance: 1000 })

    const result = await chargeForSceneResolution('camp1', 'scene1')

    // raw 30c -> metered 180c / 2 players = 90c each
    expect(result).toEqual({ ok: true, playerCount: 2, costPerPlayer: 90 })
    expect(deductFunds).toHaveBeenCalledTimes(2)
    expect(deductFunds).toHaveBeenCalledWith(
      'u1', 90, expect.stringContaining('metered AI cost'),
      expect.objectContaining({ sceneId: 'scene1', campaignId: 'camp1' })
    )
  })

  it('falls back to distinct actors when the scene has no participant list (open scene)', async () => {
    db.scene.findUnique.mockResolvedValue({ sceneNumber: 1, currentExchange: 2, participants: null })
    db.playerAction.findMany.mockResolvedValue([{ userId: 'solo' }, { userId: 'solo' }])
    db.aICostEntry.aggregate.mockResolvedValue({ _sum: { costMicros: 50_000 } }) // 5 cents raw
    db.user.findMany.mockResolvedValue([{ id: 'solo', name: 'Solo Player' }])
    ;(checkBalance as any).mockResolvedValue({ sufficient: true, currentBalance: 1000 })

    const result = await chargeForSceneResolution('camp1', 'scene1')

    expect(db.playerAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sceneId: 'scene1', exchangeNumber: 2 } })
    )
    expect(result).toEqual({ ok: true, playerCount: 1, costPerPlayer: 30 }) // 5c * 6 = 30c
    expect(deductFunds).toHaveBeenCalledTimes(1)
  })

  it('charges nobody and succeeds when there is truly no one to bill', async () => {
    db.scene.findUnique.mockResolvedValueOnce({ currentExchange: 1, participants: null })
    db.playerAction.findMany.mockResolvedValue([])

    const result = await chargeForSceneResolution('camp1', 'scene1')

    expect(result).toEqual({ ok: true, playerCount: 0, costPerPlayer: 0 })
    expect(deductFunds).not.toHaveBeenCalled()
  })

  it('blocks and charges nobody when any payer is short', async () => {
    db.scene.findUnique.mockResolvedValue({
      sceneNumber: 1, currentExchange: 1, participants: { userIds: ['rich', 'poor'] },
    })
    db.aICostEntry.aggregate.mockResolvedValue({ _sum: { costMicros: 100_000 } })
    db.user.findMany.mockResolvedValue([{ id: 'rich', name: 'Rich' }, { id: 'poor', name: 'Poor' }])
    ;(checkBalance as any).mockImplementation(async (uid: string) =>
      uid === 'poor' ? { sufficient: false, currentBalance: 0 } : { sufficient: true, currentBalance: 1000 }
    )

    const result = await chargeForSceneResolution('camp1', 'scene1')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Insufficient balance')
    expect(result.details).toContain('Poor')
    expect(deductFunds).not.toHaveBeenCalled()
  })

  it('reports scene not found', async () => {
    db.scene.findUnique.mockResolvedValue(null)

    const result = await chargeForSceneResolution('camp1', 'missing')

    expect(result).toEqual({ ok: false, error: 'Scene not found' })
  })
})
