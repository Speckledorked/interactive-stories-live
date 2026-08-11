// src/app/api/public/chronicle/[token]/recap/[logId]/__tests__/route.test.ts
// Shareable session recap: an unauthenticated read for a single CampaignLog
// entry, gated on the same chronicle share token/enabled flag the full
// chronicle uses. Covers: a disabled/nonexistent share 404s, a log from a
// DIFFERENT campaign never resolves even with a valid token (the token only
// proves you may read one campaign), and the response never includes
// campaign-internal identifiers.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { campaign: { findUnique: vi.fn() }, campaignLog: { findUnique: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req(token: string, logId: string) {
  return new NextRequest(`http://localhost/api/public/chronicle/${token}/recap/${logId}`)
}

beforeEach(() => {
  vi.clearAllMocks()
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

  it('returns 500 on an unexpected error', async () => {
    db.campaign.findUnique.mockRejectedValue(new Error('db down'))
    const response = await GET(req('live-token', 'log1'), { params: { token: 'live-token', logId: 'log1' } })
    expect(response.status).toBe(500)
  })
})
