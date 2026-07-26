// src/app/api/campaigns/[id]/notes/__tests__/broadcast.test.ts
//
// Live shared notes: the publisher half.
//
// `triggerNoteUpdate` and the `note-update` event existed with no publisher
// AND no subscriber — a realtime pipeline built end to end and connected at
// neither end, so sharing a note was invisible to everyone else until they
// reloaded. These cover the write routes now publishing on it, and
// especially the two rules that keep the campaign channel safe: a PRIVATE
// note is never broadcast, and a note leaving SHARED is retracted rather
// than silently left on other players' screens.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignMembership: { findFirst: vi.fn(), findUnique: vi.fn() },
    playerNote: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(async () => ({})),
    },
  },
}))
vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/notifications/noteShared', () => ({ notifyNoteShared: vi.fn() }))
vi.mock('@/lib/realtime/pusher-server', () => ({ broadcastNoteUpdate: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { verifyAuth } from '@/lib/auth'
import { broadcastNoteUpdate } from '@/lib/realtime/pusher-server'
import { POST } from '../route'
import { PUT, DELETE } from '../[noteId]/route'

const db = prisma as any
const broadcast = broadcastNoteUpdate as any

const author = { id: 'user1', email: 'gm@example.com', name: 'Ada' }

const noteRow = (over: Record<string, unknown> = {}) => ({
  id: 'note1',
  title: 'The Rookery',
  content: 'Third floor is watched.',
  visibility: 'SHARED',
  authorId: 'user1',
  campaignId: 'camp1',
  author,
  ...over,
})

const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/campaigns/camp1/notes', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

const params = { params: { id: 'camp1', noteId: 'note1' } }

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'user1', email: author.email })
  db.campaignMembership.findFirst.mockResolvedValue({ id: 'mem1' })
  db.campaignMembership.findUnique.mockResolvedValue({ id: 'mem1' })
})

describe('POST /notes — broadcast on create', () => {
  it('publishes a shared note to the campaign', async () => {
    db.playerNote.create.mockResolvedValue(noteRow())

    await POST(req('POST', { title: 'The Rookery', content: 'x', visibility: 'SHARED' }), { params: { id: 'camp1' } })

    expect(broadcast).toHaveBeenCalledTimes(1)
    expect(broadcast.mock.calls[0][0]).toMatchObject({
      id: 'note1',
      campaignId: 'camp1',
      visibility: 'SHARED',
      action: 'created',
      content: 'Third floor is watched.',
    })
  })

  it('still calls through for a private note, and marks it PRIVATE', async () => {
    // The guard lives in triggerNoteUpdate, which drops it. What matters
    // here is that the visibility is reported honestly — mislabeling it
    // would publish a private note to the whole campaign.
    db.playerNote.create.mockResolvedValue(noteRow({ visibility: 'PRIVATE' }))

    await POST(req('POST', { title: 'x', content: 'y' }), { params: { id: 'camp1' } })

    expect(broadcast.mock.calls[0][0].visibility).toBe('PRIVATE')
  })
})

describe('PUT /notes/[id] — broadcast on edit', () => {
  it('publishes the new body when a shared note is edited', async () => {
    db.playerNote.findFirst.mockResolvedValue(noteRow())
    db.playerNote.update.mockResolvedValue(noteRow({ content: 'Fourth floor, actually.' }))

    await PUT(req('PUT', { content: 'Fourth floor, actually.' }), params)

    expect(broadcast.mock.calls[0][0]).toMatchObject({
      action: 'updated',
      visibility: 'SHARED',
      content: 'Fourth floor, actually.',
    })
  })

  it('retracts a note that goes from SHARED to PRIVATE', async () => {
    // The load-bearing case. Broadcasting the note's NEW visibility would
    // be dropped by the guard, leaving the note on every other player's
    // screen forever. It goes out under its old visibility, as a delete.
    db.playerNote.findFirst.mockResolvedValue(noteRow({ visibility: 'SHARED' }))
    db.playerNote.update.mockResolvedValue(noteRow({ visibility: 'PRIVATE' }))

    await PUT(req('PUT', { visibility: 'PRIVATE' }), params)

    expect(broadcast.mock.calls[0][0]).toMatchObject({
      id: 'note1',
      action: 'deleted',
      visibility: 'SHARED',
    })
  })

  it('does not send the content along with a retraction', async () => {
    // The point of the event is to take the note back, not to deliver it
    // one last time to the people losing access.
    db.playerNote.findFirst.mockResolvedValue(noteRow({ visibility: 'SHARED' }))
    db.playerNote.update.mockResolvedValue(noteRow({ visibility: 'PRIVATE' }))

    await PUT(req('PUT', { visibility: 'PRIVATE' }), params)

    expect(broadcast.mock.calls[0][0].content).toBe('')
    expect(broadcast.mock.calls[0][0].title).toBe('')
  })

  it('reports a note that was already private as private, not as a retraction', async () => {
    db.playerNote.findFirst.mockResolvedValue(noteRow({ visibility: 'PRIVATE' }))
    db.playerNote.update.mockResolvedValue(noteRow({ visibility: 'PRIVATE', content: 'edited' }))

    await PUT(req('PUT', { content: 'edited' }), params)

    expect(broadcast.mock.calls[0][0]).toMatchObject({ visibility: 'PRIVATE', action: 'updated' })
  })
})

describe('DELETE /notes/[id] — broadcast on delete', () => {
  it('retracts a deleted shared note under its own visibility', async () => {
    db.playerNote.findFirst.mockResolvedValue(noteRow())

    await DELETE(req('DELETE'), params)

    expect(broadcast.mock.calls[0][0]).toMatchObject({
      id: 'note1',
      action: 'deleted',
      visibility: 'SHARED',
      content: '',
    })
  })

  it('does not broadcast anything when the note was not the caller’s to delete', async () => {
    db.playerNote.findFirst.mockResolvedValue(null)

    const res = await DELETE(req('DELETE'), params)

    expect(res.status).toBe(404)
    expect(broadcast).not.toHaveBeenCalled()
  })
})

describe('authorization still gates the broadcast', () => {
  it('publishes nothing for a non-member', async () => {
    db.campaignMembership.findFirst.mockResolvedValue(null)
    db.campaignMembership.findUnique.mockResolvedValue(null)

    await POST(req('POST', { title: 'x', content: 'y', visibility: 'SHARED' }), { params: { id: 'camp1' } })

    expect(broadcast).not.toHaveBeenCalled()
    expect(db.playerNote.create).not.toHaveBeenCalled()
  })

  it('publishes nothing for an unauthenticated caller', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)

    await POST(req('POST', { title: 'x', content: 'y', visibility: 'SHARED' }), { params: { id: 'camp1' } })

    expect(broadcast).not.toHaveBeenCalled()
  })
})
