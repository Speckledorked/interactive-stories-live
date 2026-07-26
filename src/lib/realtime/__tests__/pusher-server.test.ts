// src/lib/realtime/__tests__/pusher-server.test.ts
//
// The visibility guard on note broadcasts is a security boundary, not a
// filter: `campaign-${id}` goes to every member, so a PRIVATE note reaching
// it is a leak. It had no test because it had no caller.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RealtimeNoteUpdate } from '../pusher-client'

const trigger = vi.fn(async () => ({}))
vi.mock('pusher', () => ({
  default: class {
    trigger = trigger
  },
}))

import { triggerNoteUpdate, broadcastNoteUpdate } from '../pusher-server'

const note = (over: Partial<RealtimeNoteUpdate> = {}): RealtimeNoteUpdate => ({
  id: 'note1',
  title: 'The Rookery',
  content: 'Third floor is watched.',
  visibility: 'SHARED',
  authorId: 'user1',
  campaignId: 'camp1',
  action: 'created',
  author: { id: 'user1', email: 'gm@example.com' },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PUSHER_APP_ID = 'id'
  process.env.PUSHER_KEY = 'key'
  process.env.PUSHER_SECRET = 'secret'
  process.env.PUSHER_CLUSTER = 'eu'
})

describe('triggerNoteUpdate', () => {
  it('publishes a SHARED note on the campaign channel', async () => {
    await triggerNoteUpdate(note())
    expect(trigger).toHaveBeenCalledWith('campaign-camp1', 'note-update', expect.objectContaining({ id: 'note1' }))
  })

  it('publishes a GM note', async () => {
    await triggerNoteUpdate(note({ visibility: 'GM' }))
    expect(trigger).toHaveBeenCalled()
  })

  it('never publishes a PRIVATE note', async () => {
    // The leak this exists to prevent. Every member is on this channel.
    await triggerNoteUpdate(note({ visibility: 'PRIVATE' }))
    expect(trigger).not.toHaveBeenCalled()
  })

  it('does nothing at all when Pusher is unconfigured', async () => {
    delete process.env.PUSHER_SECRET
    await expect(triggerNoteUpdate(note())).resolves.toBeUndefined()
    expect(trigger).not.toHaveBeenCalled()
  })
})

describe('broadcastNoteUpdate', () => {
  it('swallows a realtime failure rather than failing the note write', async () => {
    // A note must save whether or not the socket layer is healthy — the
    // same contract notifyNoteShared follows on these routes.
    trigger.mockRejectedValueOnce(new Error('pusher down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => broadcastNoteUpdate(note())).not.toThrow()
    await new Promise(r => setImmediate(r))

    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
