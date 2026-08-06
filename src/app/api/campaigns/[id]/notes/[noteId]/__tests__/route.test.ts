// src/app/api/campaigns/[id]/notes/[noteId]/__tests__/route.test.ts
// #135 (cont.) — player notes had no test coverage: GET's visibility
// filter (only the author's own PRIVATE notes, plus SHARED/GM ones),
// PUT/DELETE's author-only ownership gate, and the "going private is a
// retraction that must broadcast with content stripped" behavior were all
// unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerNote: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    character: { findFirst: vi.fn() },
    nPC: { findFirst: vi.fn() },
    faction: { findFirst: vi.fn() },
    scene: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/notifications/noteShared', () => ({ notifyNoteShared: vi.fn() }))
vi.mock('@/lib/realtime/pusher-server', () => ({ broadcastNoteUpdate: vi.fn() }))

import { verifyAuth } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { notifyNoteShared } from '@/lib/notifications/noteShared'
import { broadcastNoteUpdate } from '@/lib/realtime/pusher-server'
import { GET, PUT, DELETE } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/notes/note1')
}

function putRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/notes/note1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/notes/note1', { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'player1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1', noteId: 'note1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1', noteId: 'note1' } })
    expect(response.status).toBe(403)
  })

  it('404s for a note that does not match the visibility filter (e.g. someone else\'s private note)', async () => {
    db.playerNote.findFirst.mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1', noteId: 'note1' } })
    expect(response.status).toBe(404)
  })

  it('returns a visible note', async () => {
    db.playerNote.findFirst.mockResolvedValue({ id: 'note1', title: 'Clue', visibility: 'SHARED' })
    const response = await GET(getRequest(), { params: { id: 'camp1', noteId: 'note1' } })
    expect(response.status).toBe(200)
  })
})

describe('PUT', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await PUT(putRequest({ title: 'New' }), { params: { id: 'camp1', noteId: 'note1' } })
    expect(response.status).toBe(401)
  })

  it('404s when the note is not yours (only the author can edit)', async () => {
    db.playerNote.findFirst.mockResolvedValue(null)
    const response = await PUT(putRequest({ title: 'New' }), { params: { id: 'camp1', noteId: 'note1' } })
    expect(response.status).toBe(404)
    expect(db.playerNote.update).not.toHaveBeenCalled()
  })

  it('rejects an empty title', async () => {
    db.playerNote.findFirst.mockResolvedValue({ id: 'note1', authorId: 'player1', visibility: 'PRIVATE' })
    const response = await PUT(putRequest({ title: '   ' }), { params: { id: 'camp1', noteId: 'note1' } })
    expect(response.status).toBe(400)
  })

  it('rejects an invalid visibility value', async () => {
    db.playerNote.findFirst.mockResolvedValue({ id: 'note1', authorId: 'player1', visibility: 'PRIVATE' })
    const response = await PUT(putRequest({ visibility: 'EVERYONE' }), { params: { id: 'camp1', noteId: 'note1' } })
    expect(response.status).toBe(400)
  })

  it('rejects a characterId that does not belong to this campaign', async () => {
    db.playerNote.findFirst.mockResolvedValue({ id: 'note1', authorId: 'player1', visibility: 'PRIVATE' })
    db.character.findFirst.mockResolvedValue(null)
    const response = await PUT(putRequest({ characterId: 'char1' }), { params: { id: 'camp1', noteId: 'note1' } })
    expect(response.status).toBe(400)
  })

  it('notifies the table when a note newly becomes SHARED', async () => {
    db.playerNote.findFirst.mockResolvedValue({ id: 'note1', authorId: 'player1', visibility: 'PRIVATE' })
    db.playerNote.update.mockResolvedValue({
      id: 'note1', title: 'Clue', content: 'text', visibility: 'SHARED', authorId: 'player1',
      author: { id: 'player1', name: 'Player', email: 'p@b.com' },
    })

    await PUT(putRequest({ visibility: 'SHARED' }), { params: { id: 'camp1', noteId: 'note1' } })

    expect(notifyNoteShared).toHaveBeenCalledWith('camp1', 'player1', 'Player', 'Clue')
  })

  it('does not re-notify when an already-shared note is just edited', async () => {
    db.playerNote.findFirst.mockResolvedValue({ id: 'note1', authorId: 'player1', visibility: 'SHARED' })
    db.playerNote.update.mockResolvedValue({
      id: 'note1', title: 'Clue', content: 'new text', visibility: 'SHARED', authorId: 'player1',
      author: { id: 'player1', name: 'Player', email: 'p@b.com' },
    })

    await PUT(putRequest({ visibility: 'SHARED', content: 'new text' }), { params: { id: 'camp1', noteId: 'note1' } })

    expect(notifyNoteShared).not.toHaveBeenCalled()
  })

  it('broadcasts a stripped-content retraction when a note goes private', async () => {
    db.playerNote.findFirst.mockResolvedValue({ id: 'note1', authorId: 'player1', visibility: 'SHARED' })
    db.playerNote.update.mockResolvedValue({
      id: 'note1', title: 'Clue', content: 'text', visibility: 'PRIVATE', authorId: 'player1',
      author: { id: 'player1', name: 'Player', email: 'p@b.com' },
    })

    await PUT(putRequest({ visibility: 'PRIVATE' }), { params: { id: 'camp1', noteId: 'note1' } })

    expect(broadcastNoteUpdate).toHaveBeenCalledWith(expect.objectContaining({
      title: '', content: '', visibility: 'SHARED', action: 'deleted',
    }))
  })
})

describe('DELETE', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', noteId: 'note1' } })
    expect(response.status).toBe(401)
  })

  it('404s when the note is not yours', async () => {
    db.playerNote.findFirst.mockResolvedValue(null)
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', noteId: 'note1' } })
    expect(response.status).toBe(404)
    expect(db.playerNote.delete).not.toHaveBeenCalled()
  })

  it('deletes the note and broadcasts a retraction', async () => {
    db.playerNote.findFirst.mockResolvedValue({ id: 'note1', authorId: 'player1', visibility: 'SHARED' })
    db.playerNote.delete.mockResolvedValue({ id: 'note1' })

    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', noteId: 'note1' } })

    expect(response.status).toBe(200)
    expect(broadcastNoteUpdate).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleted', title: '', content: '' }))
  })
})
