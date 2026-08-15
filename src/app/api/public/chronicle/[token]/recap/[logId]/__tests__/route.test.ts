// src/app/api/public/chronicle/[token]/recap/[logId]/__tests__/route.test.ts
// Shareable session recap: an unauthenticated read for a single CampaignLog
// entry, gated on the same chronicle share token/enabled flag the full
// chronicle uses. Covers: a disabled/nonexistent share 404s, a log from a
// DIFFERENT campaign never resolves even with a valid token (the token only
// proves you may read one campaign), the response never includes
// campaign-internal identifiers, and (#264) a successful load increments
// recapViewCount — the smallest real signal of whether sharing is used.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { campaign: { findUnique: vi.fn() }, campaignLog: { findUnique: vi.fn(), update: vi.fn() } },
}))
vi.mock('@/lib/rateLimit', () => ({
  RECAP_VIEW_LIMIT: { bucket: 'recap-view', limit: 1, windowSeconds: 3600 },
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rateLimit'
import { GET } from '../route'

const db = prisma as any

function req(token: string, logId: string) {
  return new NextRequest(`http://localhost/api/public/chronicle/${token}/recap/${logId}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true, remaining: 0, retryAfterSeconds: 0 })
})

describe('GET', () => {
  it('404s for an unknown token', async () => {
    db.campaign.findUnique.mockResolvedValue(null)
    const response = await GET(req('bad-token', 'log1'), { params: { token: 'bad-token', logId: 'log1' } })
    expect(response.status).toBe(404)
    expect(db.campaignLog.findUnique).not.toHaveBeenCalled()
  })

  it('404s for a token whose sharing has been disabled', async () => {
    db.campaign.findUnique.mockResolvedValue({ id: 'camp1', title: 'T', chronicleShareEnabled: false })
    const response = await GET(req('old-token', 'log1'), { params: { token: 'old-token', logId: 'log1' } })
    expect(response.status).toBe(404)
    expect(db.campaignLog.findUnique).not.toHaveBeenCalled()
  })

  it('404s when the log does not exist', async () => {
    db.campaign.findUnique.mockResolvedValue({ id: 'camp1', title: 'T', universe: null, heroImageUrl: null, chronicleShareEnabled: true })
    db.campaignLog.findUnique.mockResolvedValue(null)
    const response = await GET(req('live-token', 'missing'), { params: { token: 'live-token', logId: 'missing' } })
    expect(response.status).toBe(404)
  })

  it('404s when the log belongs to a DIFFERENT campaign — a valid token only proves access to its own campaign', async () => {
    db.campaign.findUnique.mockResolvedValue({ id: 'camp1', title: 'T', universe: null, heroImageUrl: null, chronicleShareEnabled: true })
    db.campaignLog.findUnique.mockResolvedValue({
      id: 'log1', campaignId: 'camp2', title: 'Someone else\'s scene', summary: 's', highlights: [], entryType: 'scene', inGameDate: null, turnNumber: 1,
    })
    const response = await GET(req('live-token', 'log1'), { params: { token: 'live-token', logId: 'log1' } })
    expect(response.status).toBe(404)
  })

  it('returns campaign and recap fields, never internal identifiers', async () => {
    db.campaign.findUnique.mockResolvedValue({ id: 'camp1', title: 'The Ashen Vow', universe: 'Original', heroImageUrl: 'https://x/y.jpg', chronicleShareEnabled: true })
    db.campaignLog.findUnique.mockResolvedValue({
      id: 'log1', campaignId: 'camp1', title: 'The Siege Breaks', summary: 'They held the gate.',
      highlights: ['Kess fell', 'The gate held'], entryType: 'scene', inGameDate: 'Day 12', turnNumber: 5,
    })
    db.campaignLog.update.mockResolvedValue({})
    const response = await GET(req('live-token', 'log1'), { params: { token: 'live-token', logId: 'log1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({
      campaign: { title: 'The Ashen Vow', universe: 'Original', heroImageUrl: 'https://x/y.jpg' },
      recap: {
        title: 'The Siege Breaks', summary: 'They held the gate.', highlights: ['Kess fell', 'The gate held'],
        entryType: 'scene', inGameDate: 'Day 12', turnNumber: 5,
      },
    })
    expect(JSON.stringify(body)).not.toContain('chronicleShareToken')
    expect(JSON.stringify(body)).not.toContain('camp1')
  })

  it('increments recapViewCount for the loaded log on a successful load (#264)', async () => {
    db.campaign.findUnique.mockResolvedValue({ id: 'camp1', title: 'T', universe: null, heroImageUrl: null, chronicleShareEnabled: true })
    db.campaignLog.findUnique.mockResolvedValue({
      id: 'log1', campaignId: 'camp1', title: 'The Siege Breaks', summary: 's',
      highlights: [], entryType: 'scene', inGameDate: null, turnNumber: 5,
    })
    db.campaignLog.update.mockResolvedValue({})
    await GET(req('live-token', 'log1'), { params: { token: 'live-token', logId: 'log1' } })
    expect(db.campaignLog.update).toHaveBeenCalledWith({
      where: { id: 'log1' },
      data: { recapViewCount: { increment: 1 } },
    })
  })

  it('does not increment recapViewCount when the log 404s', async () => {
    db.campaign.findUnique.mockResolvedValue({ id: 'camp1', title: 'T', universe: null, heroImageUrl: null, chronicleShareEnabled: true })
    db.campaignLog.findUnique.mockResolvedValue(null)
    await GET(req('live-token', 'missing'), { params: { token: 'live-token', logId: 'missing' } })
    expect(db.campaignLog.update).not.toHaveBeenCalled()
  })

  // #324: unconditionally incrementing on every hit let a trivial scripted
  // loop inflate the count arbitrarily.
  it('#324: does not increment recapViewCount once the per-IP/recap view limit is already used up', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 1800 })
    db.campaign.findUnique.mockResolvedValue({ id: 'camp1', title: 'T', universe: null, heroImageUrl: null, chronicleShareEnabled: true })
    db.campaignLog.findUnique.mockResolvedValue({
      id: 'log1', campaignId: 'camp1', title: 'The Siege Breaks', summary: 's',
      highlights: [], entryType: 'scene', inGameDate: null, turnNumber: 5,
    })
    const response = await GET(req('live-token', 'log1'), { params: { token: 'live-token', logId: 'log1' } })
    expect(response.status).toBe(200) // the view itself still succeeds — only the counter is gated
    expect(db.campaignLog.update).not.toHaveBeenCalled()
  })

  it('#324: keys the dedup on IP + the specific recap, not just IP', async () => {
    db.campaign.findUnique.mockResolvedValue({ id: 'camp1', title: 'T', universe: null, heroImageUrl: null, chronicleShareEnabled: true })
    db.campaignLog.findUnique.mockResolvedValue({
      id: 'log1', campaignId: 'camp1', title: 'The Siege Breaks', summary: 's',
      highlights: [], entryType: 'scene', inGameDate: null, turnNumber: 5,
    })
    db.campaignLog.update.mockResolvedValue({})
    await GET(req('live-token', 'log1'), { params: { token: 'live-token', logId: 'log1' } })
    expect(checkRateLimit).toHaveBeenCalledWith('127.0.0.1:log1', 'recap-view', 1, 3600)
  })

  it('returns 500 on an unexpected error', async () => {
    db.campaign.findUnique.mockRejectedValue(new Error('db down'))
    const response = await GET(req('live-token', 'log1'), { params: { token: 'live-token', logId: 'log1' } })
    expect(response.status).toBe(500)
  })
})
