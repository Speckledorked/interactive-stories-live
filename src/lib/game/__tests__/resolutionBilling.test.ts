// src/lib/game/__tests__/resolutionBilling.test.ts
// Per-scene-resolution billing: who pays, at what tier, and the
// open-scene fallback that bills actual actors rather than a predefined
// (and, for open scenes, always-empty) participant list.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    scene: { findUnique: vi.fn() },
    playerAction: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/payment/service', () => ({
  checkBalance: vi.fn(),
  deductFunds: vi.fn(),
  formatCurrency: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}))

import { prisma } from '@/lib/prisma'
import { checkBalance, deductFunds } from '@/lib/payment/service'
import { chargeForSceneResolution, getSceneCostPerPlayer } from '../resolutionBilling'

const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getSceneCostPerPlayer', () => {
  it('tiers by group size', () => {
    expect(getSceneCostPerPlayer(1)).toBe(25)
    expect(getSceneCostPerPlayer(0)).toBe(25)
    expect(getSceneCostPerPlayer(4)).toBe(50)
    expect(getSceneCostPerPlayer(6)).toBe(75)
  })
})

describe('chargeForSceneResolution', () => {
  it('bills every predefined participant on a closed scene', async () => {
    db.scene.findUnique.mockResolvedValue({
      sceneNumber: 3, currentExchange: 1,
      participants: { userIds: ['u1', 'u2'] },
    })
    db.user.findMany.mockResolvedValue([{ id: 'u1', name: 'A' }, { id: 'u2', name: 'B' }])
    ;(checkBalance as any).mockResolvedValue({ sufficient: true, currentBalance: 1000 })

    const result = await chargeForSceneResolution('camp1', 'scene1')

    expect(result).toEqual({ ok: true, playerCount: 2, costPerPlayer: 50 })
    expect(deductFunds).toHaveBeenCalledTimes(2)
    expect(deductFunds).toHaveBeenCalledWith('u1', 50, expect.any(String), { sceneId: 'scene1', campaignId: 'camp1' })
  })

  it('falls back to distinct actors when the scene has no participant list (open scene)', async () => {
    db.scene.findUnique.mockResolvedValue({
      sceneNumber: 1, currentExchange: 2, participants: null,
    })
    db.playerAction.findMany.mockResolvedValue([{ userId: 'solo' }, { userId: 'solo' }])
    db.user.findMany.mockResolvedValue([{ id: 'solo', name: 'Solo Player' }])
    ;(checkBalance as any).mockResolvedValue({ sufficient: true, currentBalance: 1000 })

    const result = await chargeForSceneResolution('camp1', 'scene1')

    expect(db.playerAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sceneId: 'scene1', exchangeNumber: 2 } })
    )
    expect(result).toEqual({ ok: true, playerCount: 1, costPerPlayer: 25 })
    expect(deductFunds).toHaveBeenCalledTimes(1)
  })

  it('charges nobody and succeeds when there is truly no one to bill', async () => {
    db.scene.findUnique.mockResolvedValue({ sceneNumber: 1, currentExchange: 1, participants: null })
    db.playerAction.findMany.mockResolvedValue([])

    const result = await chargeForSceneResolution('camp1', 'scene1')

    expect(result).toEqual({ ok: true, playerCount: 0, costPerPlayer: 0 })
    expect(deductFunds).not.toHaveBeenCalled()
  })

  it('blocks and charges nobody when any payer is short', async () => {
    db.scene.findUnique.mockResolvedValue({
      sceneNumber: 1, currentExchange: 1, participants: { userIds: ['rich', 'poor'] },
    })
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
