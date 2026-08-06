// src/app/api/campaigns/[id]/messages/__tests__/route.test.ts
// #135 (cont.) — campaign chat had no test coverage: GET's blocked-user
// filtering (blocking hides someone for the blocker without removing them
// from the campaign), POST's whisper-target/IC-character-ownership
// validation, and that @mentions/whispers are skipped for WHISPER/SYSTEM
// messages, were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userBlock: { findMany: vi.fn() },
    message: { findMany: vi.fn(), create: vi.fn() },
    character: { findFirst: vi.fn() },
    campaignMembership: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/realtime/pusher-server', () => ({ default: vi.fn() }))
vi.mock('@/lib/notifications/mentions', () => ({ detectMentions: vi.fn() }))
vi.mock('@/lib/notifications/notification-service', () => ({
  NotificationService: { createNotification: vi.fn() },
}))

import { verifyAuth } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import PusherServer from '@/lib/realtime/pusher-server'
import { detectMentions } from '@/lib/notifications/mentions'
import { NotificationService } from '@/lib/notifications/notification-service'
import { GET, POST } from '../route'

const db = prisma as any

function getRequest(query = '') {
  return new NextRequest(`http://localhost/api/campaigns/camp1/messages${query}`)
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'player1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  db.userBlock.findMany.mockResolvedValue([])
  db.message.findMany.mockResolvedValue([])
  ;(detectMentions as any).mockReturnValue([])
  ;(PusherServer as any).mockReturnValue(null)
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('excludes messages from a blocked author', async () => {
    db.userBlock.findMany.mockResolvedValue([{ blockedUserId: 'blocked1' }])
    await GET(getRequest(), { params: { id: 'camp1' } })
    expect(db.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ authorId: { notIn: ['blocked1'] } }),
    }))
  })

  it('returns messages oldest-first even though the query is newest-first', async () => {
    db.message.findMany.mockResolvedValue([{ id: 'm2', createdAt: 2 }, { id: 'm1', createdAt: 1 }])
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.messages).toEqual([{ id: 'm1', createdAt: 1 }, { id: 'm2', createdAt: 2 }])
  })
})

describe('POST', () => {
  const icBody = { content: 'Hello there', type: 'IN_CHARACTER' }

  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await POST(postRequest(icBody), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects empty content', async () => {
    const response = await POST(postRequest({ content: '   ', type: 'OUT_OF_CHARACTER' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('rejects an invalid message type', async () => {
    const response = await POST(postRequest({ content: 'hi', type: 'SHOUT' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await POST(postRequest({ content: 'hi', type: 'OUT_OF_CHARACTER' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('rejects a whisper to someone not in the campaign', async () => {
    ;(getCampaignMembership as any).mockImplementation((userId: string) => userId === 'player1' ? { role: 'PLAYER' } : null)
    const response = await POST(postRequest({ content: 'psst', type: 'WHISPER', targetUserId: 'not-a-member' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('rejects an IC message for a character you do not own', async () => {
    db.character.findFirst.mockResolvedValue(null)
    const response = await POST(postRequest({ ...icBody, characterId: 'not-yours' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('skips mention detection for a whisper', async () => {
    db.message.create.mockResolvedValue({ id: 'm1', author: { name: 'Player', email: 'p@b.com' }, content: 'psst' })
    ;(getCampaignMembership as any).mockImplementation((userId: string) => ({ role: 'PLAYER' }))
    await POST(postRequest({ content: 'psst', type: 'WHISPER', targetUserId: 'other1' }), { params: { id: 'camp1' } })
    expect(detectMentions).not.toHaveBeenCalled()
  })

  it('creates the message and notifies mentioned users', async () => {
    db.campaignMembership.findMany.mockResolvedValue([{ user: { id: 'other1', name: 'Other', email: 'o@b.com' } }])
    ;(detectMentions as any).mockReturnValue(['other1'])
    db.message.create.mockResolvedValue({ id: 'm1', author: { name: 'Player', email: 'p@b.com' }, content: '@Other hi' })

    const response = await POST(postRequest({ content: '@Other hi', type: 'OUT_OF_CHARACTER' }), { params: { id: 'camp1' } })

    expect(response.status).toBe(200)
    expect(NotificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'MENTION', userId: 'other1' })
    )
  })

  it('broadcasts to both the campaign and target-user channels for a whisper', async () => {
    const trigger = vi.fn().mockResolvedValue(undefined)
    ;(PusherServer as any).mockReturnValue({ trigger })
    db.message.create.mockResolvedValue({ id: 'm1', author: { name: 'Player', email: 'p@b.com' }, content: 'psst' })

    await POST(postRequest({ content: 'psst', type: 'WHISPER', targetUserId: 'other1' }), { params: { id: 'camp1' } })

    expect(trigger).toHaveBeenCalledWith('campaign-camp1', 'new-message', expect.anything())
    expect(trigger).toHaveBeenCalledWith('user-other1', 'new-whisper', expect.anything())
  })

  it('still succeeds when the Pusher broadcast fails', async () => {
    ;(PusherServer as any).mockReturnValue({ trigger: vi.fn().mockRejectedValue(new Error('down')) })
    db.message.create.mockResolvedValue({ id: 'm1', author: { name: 'Player', email: 'p@b.com' }, content: 'hi' })
    const response = await POST(postRequest({ content: 'hi', type: 'OUT_OF_CHARACTER' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(200)
  })
})
