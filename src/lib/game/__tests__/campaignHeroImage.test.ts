// src/lib/game/__tests__/campaignHeroImage.test.ts
// Mirrors imageGenQueue.test.ts's kickImageJob coverage shape for the
// self-fetch kick (non-OK response and thrown-error both fall back to
// inline processing), plus the PENDING/READY/FAILED status lifecycle.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  },
}))
vi.mock('../../ai/imageGeneration', () => ({
  buildCampaignHeroPrompt: vi.fn().mockReturnValue('a prompt'),
  generateHeroImage: vi.fn(),
}))
vi.mock('../../blob/campaignHeroStorage', () => ({
  uploadCampaignHeroImage: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { generateHeroImage } from '../../ai/imageGeneration'
import { uploadCampaignHeroImage } from '../../blob/campaignHeroStorage'
import { generateCampaignHeroImage, kickCampaignHeroImage } from '../campaignHeroImage'

const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

describe('generateCampaignHeroImage', () => {
  it('does nothing when the campaign is missing', async () => {
    db.campaign.findUnique.mockResolvedValue(null)
    await generateCampaignHeroImage('camp1')
    expect(generateHeroImage).not.toHaveBeenCalled()
  })

  it('sets PENDING, then READY with the uploaded URL on success', async () => {
    db.campaign.findUnique.mockResolvedValue({ title: 'T', description: null, universe: 'U' })
    ;(generateHeroImage as any).mockResolvedValue({ imageBuffer: Buffer.from('x'), contentType: 'image/png' })
    ;(uploadCampaignHeroImage as any).mockResolvedValue('https://blob.example/camp1.png')

    await generateCampaignHeroImage('camp1')

    expect(db.campaign.update).toHaveBeenCalledWith({ where: { id: 'camp1' }, data: { heroImageStatus: 'PENDING' } })
    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp1' },
      data: { heroImageUrl: 'https://blob.example/camp1.png', heroImageStatus: 'READY' },
    })
  })

  it('sets FAILED on a generation error, never throwing', async () => {
    db.campaign.findUnique.mockResolvedValue({ title: 'T', description: null, universe: 'U' })
    ;(generateHeroImage as any).mockRejectedValue(new Error('rate limited'))

    await expect(generateCampaignHeroImage('camp1')).resolves.toBeUndefined()

    expect(db.campaign.update).toHaveBeenCalledWith({ where: { id: 'camp1' }, data: { heroImageStatus: 'FAILED' } })
  })

  it('sets FAILED on an upload error, never throwing', async () => {
    db.campaign.findUnique.mockResolvedValue({ title: 'T', description: null, universe: 'U' })
    ;(generateHeroImage as any).mockResolvedValue({ imageBuffer: Buffer.from('x'), contentType: 'image/png' })
    ;(uploadCampaignHeroImage as any).mockRejectedValue(new Error('missing BLOB_READ_WRITE_TOKEN'))

    await expect(generateCampaignHeroImage('camp1')).resolves.toBeUndefined()

    expect(db.campaign.update).toHaveBeenCalledWith({ where: { id: 'camp1' }, data: { heroImageStatus: 'FAILED' } })
  })
})

describe('kickCampaignHeroImage (self-fetch kick, mirrors kickImageJob)', () => {
  it('falls back to inline processing when the worker route responds fast but non-OK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    db.campaign.findUnique.mockResolvedValue({ title: 'T', description: null, universe: 'U' })
    ;(generateHeroImage as any).mockResolvedValue({ imageBuffer: Buffer.from('x'), contentType: 'image/png' })
    ;(uploadCampaignHeroImage as any).mockResolvedValue('https://blob.example/camp1.png')

    await kickCampaignHeroImage('camp1')

    expect(db.campaign.update).toHaveBeenCalledWith({ where: { id: 'camp1' }, data: { heroImageStatus: 'PENDING' } })
  })

  it('falls back to inline processing when the kick itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    db.campaign.findUnique.mockResolvedValue({ title: 'T', description: null, universe: 'U' })
    ;(generateHeroImage as any).mockResolvedValue({ imageBuffer: Buffer.from('x'), contentType: 'image/png' })
    ;(uploadCampaignHeroImage as any).mockResolvedValue('https://blob.example/camp1.png')

    await kickCampaignHeroImage('camp1')

    expect(db.campaign.update).toHaveBeenCalledWith({ where: { id: 'camp1' }, data: { heroImageStatus: 'PENDING' } })
  })

  it('does not fall back to inline processing on an OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    await kickCampaignHeroImage('camp1')
    expect(db.campaign.findUnique).not.toHaveBeenCalled()
  })
})
