// src/lib/safety/__tests__/safety-service.test.ts
// X-Card pause/resume (previously pauseScene was a no-op — see the schema
// comment on Scene.isPaused) and the settings upsert that backs the new
// safety-settings admin route (previously no route ever called this).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignSafetySettings: { findUnique: vi.fn(), upsert: vi.fn() },
    xCardUse: { create: vi.fn() },
    campaignMembership: { findMany: vi.fn() },
    notification: { create: vi.fn() },
    scene: { update: vi.fn() },
    campaignBan: { findUnique: vi.fn(), delete: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { SafetyService } from '../safety-service'

const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getCampaignSafety', () => {
  it('creates default settings on first read', async () => {
    db.campaignSafetySettings.findUnique.mockResolvedValue(null)
    db.campaignSafetySettings.upsert.mockResolvedValue({ campaignId: 'c1', xCardEnabled: true })

    const settings = await SafetyService.getCampaignSafety('c1')

    expect(db.campaignSafetySettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: 'c1' } })
    )
    expect(settings.xCardEnabled).toBe(true)
  })

  it('returns the existing row without upserting when one exists', async () => {
    db.campaignSafetySettings.findUnique.mockResolvedValue({ campaignId: 'c1', xCardEnabled: false })

    await SafetyService.getCampaignSafety('c1')

    expect(db.campaignSafetySettings.upsert).not.toHaveBeenCalled()
  })
})

describe('updateSafetySettings', () => {
  it('upserts so it works even with no existing row (no admin UI ever called this before)', async () => {
    db.campaignSafetySettings.upsert.mockResolvedValue({ campaignId: 'c1', lines: ['a line'] })

    const result = await SafetyService.updateSafetySettings('c1', { lines: ['a line'] })

    expect(db.campaignSafetySettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: 'c1' },
        update: { lines: ['a line'] },
      })
    )
    expect(result.lines).toEqual(['a line'])
  })
})

describe('useXCard — pause behavior', () => {
  it('actually pauses the scene when pauseOnXCard is on (previously a no-op)', async () => {
    db.campaignSafetySettings.findUnique.mockResolvedValue({
      xCardEnabled: true,
      anonymousXCard: true,
      pauseOnXCard: true,
      xCardNotifyGMOnly: false,
    })
    db.xCardUse.create.mockResolvedValue({ id: 'xc1', sceneId: 'scene1', trigger: 'GENERAL' })
    db.campaignMembership.findMany.mockResolvedValue([])
    db.scene.update.mockResolvedValue({ id: 'scene1', campaignId: 'c1', isPaused: true })

    await SafetyService.useXCard('c1', 'user1', 'GENERAL' as any, undefined, undefined, 'scene1')

    expect(db.scene.update).toHaveBeenCalledWith({
      where: { id: 'scene1' },
      data: expect.objectContaining({ isPaused: true, pausedReason: expect.stringContaining('GENERAL') }),
    })
  })

  it('does not touch the scene when pauseOnXCard is off', async () => {
    db.campaignSafetySettings.findUnique.mockResolvedValue({
      xCardEnabled: true,
      anonymousXCard: true,
      pauseOnXCard: false,
      xCardNotifyGMOnly: false,
    })
    db.xCardUse.create.mockResolvedValue({ id: 'xc1', sceneId: 'scene1', trigger: 'GENERAL' })
    db.campaignMembership.findMany.mockResolvedValue([])

    await SafetyService.useXCard('c1', 'user1', 'GENERAL' as any, undefined, undefined, 'scene1')

    expect(db.scene.update).not.toHaveBeenCalled()
  })

  it('rejects when X-Card is disabled for the campaign', async () => {
    db.campaignSafetySettings.findUnique.mockResolvedValue({ xCardEnabled: false })

    await expect(
      SafetyService.useXCard('c1', 'user1', 'GENERAL' as any, undefined, undefined, 'scene1')
    ).rejects.toThrow('X-Card is not enabled')
  })
})

describe('resumeScene', () => {
  it('clears the pause fields', async () => {
    db.scene.update.mockResolvedValue({ id: 'scene1', campaignId: 'c1', isPaused: false })

    const result = await SafetyService.resumeScene('scene1')

    expect(db.scene.update).toHaveBeenCalledWith({
      where: { id: 'scene1' },
      data: { isPaused: false, pausedAt: null, pausedReason: null },
    })
    expect(result.isPaused).toBe(false)
  })
})
