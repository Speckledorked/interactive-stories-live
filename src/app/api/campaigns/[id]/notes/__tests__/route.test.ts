// src/app/api/campaigns/[id]/notes/__tests__/route.test.ts
// #135 (cont.) — player notes had no test coverage: the membership gate,
// the visibility-filter branching (own PRIVATE + SHARED + GM by default,
// vs. an explicit ?visibility= override that drops the OR entirely),
// entity-reference validation scoped to THIS campaign, the visibility
// enum check, and that sharing a note notifies + broadcasts only when
// SHARED, were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/notifications/noteShared', () => ({ notifyNoteShared: vi.fn() }))
vi.mock('@/lib/realtime/pusher-server', () => ({ broadcastNoteUpdate: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerNote: { findMany: vi.fn(), create: vi.fn() },
    character: { findFirst: vi.fn() },
    nPC: { findFirst: vi.fn() },
    faction: { findFirst: vi.fn() },
    scene: { findFirst: vi.fn() },
  },
}))

import { verifyAuth } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { notifyNoteShared } from '@/lib/notifications/noteShared'
import { broadcastNoteUpdate } from '@/lib/realtime/pusher-server'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../route'

const db = prisma as any

function getRequest(query = '') {
  return new NextRequest(`http://localhost/api/campaigns/camp1/notes${query}`)
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const author = { id: 'u1', email: 'u1@example.com', name: 'U1' }

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'u1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  db.playerNote.findMany.mockResolvedValue([])
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

  it('defaults to own-private + shared + GM notes', async () => {
    await GET(getRequest(), { params: { id: 'camp1' } })
    expect(db.playerNote.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        campaignId: 'camp1',
        OR: [
          { authorId: 'u1', visibility: 'PRIVATE' },
          { visibility: 'SHARED' },
          { visibility: 'GM' },
        ],
      }),
    }))
  })

  it('drops the OR clause entirely for an explicit visibility filter', async () => {
    await GET(getRequest('?visibility=SHARED'), { params: { id: 'camp1' } })
    const call = db.playerNote.findMany.mock.calls[0][0]
    expect(call.where.visibility).toBe('SHARED')
    expect(call.where.OR).toBeUndefined()
  })

  it('filters by entity type and id', async () => {
    await GET(getRequest('?entityType=npc&entityId=npc1'), { params: { id: 'camp1' } })
    const call = db.playerNote.findMany.mock.calls[0][0]
    expect(call.where.npcId).toBe('npc1')
  })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await POST(postRequest({ title: 'T', content: 'C' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('requires title and content', async () => {
    const response = await POST(postRequest({ title: '  ', content: 'C' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('rejects an invalid visibility value', async () => {
    const response = await POST(postRequest({ title: 'T', content: 'C', visibility: 'PUBLIC' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await POST(postRequest({ title: 'T', content: 'C' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('rejects a characterId that does not belong to this campaign', async () => {
    db.character.findFirst.mockResolvedValue(null)
    const response = await POST(postRequest({ title: 'T', content: 'C', characterId: 'other-camp-char' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(db.playerNote.create).not.toHaveBeenCalled()
  })

  it('creates a PRIVATE note without notifying or broadcasting', async () => {
    db.playerNote.create.mockResolvedValue({
      id: 'n1', title: 'T', content: 'C', visibility: 'PRIVATE', authorId: 'u1', author,
    })
    const response = await POST(postRequest({ title: 'T', content: 'C' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(200)
    expect(notifyNoteShared).not.toHaveBeenCalled()
    expect(broadcastNoteUpdate).toHaveBeenCalled()
  })

  it('notifies when a note is created as SHARED', async () => {
    db.playerNote.create.mockResolvedValue({
      id: 'n1', title: 'T', content: 'C', visibility: 'SHARED', authorId: 'u1', author,
    })
    await POST(postRequest({ title: 'T', content: 'C', visibility: 'SHARED' }), { params: { id: 'camp1' } })
    expect(notifyNoteShared).toHaveBeenCalledWith('camp1', 'u1', 'U1', 'T')
  })
})
