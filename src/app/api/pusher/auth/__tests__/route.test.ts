// src/app/api/pusher/auth/__tests__/route.test.ts
//
// #491: this route did not exist, and both Pusher channels were public —
// subscribable by anyone with the app key, which ships in the client
// bundle. The `private-` prefix makes Pusher demand a signature; this route
// is the only thing deciding who gets one. Every branch below is therefore
// load-bearing in a way a normal authorisation test is not: a wrong grant
// here is not a wrong page, it is a live feed of someone else's whispers.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))

const authorizeChannel = vi.fn(() => ({ auth: 'key:signature' }))
vi.mock('@/lib/realtime/pusher-server', () => ({ PusherServer: vi.fn(() => ({ authorizeChannel })) }))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { PusherServer } from '@/lib/realtime/pusher-server'
import { POST } from '../route'

/** pusher-js posts form-encoded, not JSON. Reading it as JSON would fail
 *  on every real request while passing any test that sent JSON. */
function req(fields: Record<string, string>) {
  const body = new FormData()
  for (const [k, v] of Object.entries(fields)) body.append(k, v)
  return new Request('http://localhost/api/pusher/auth', { method: 'POST', body }) as any
}

const VALID = { socket_id: '123.456', channel_name: 'private-campaign-camp1' }

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'user1', email: 'a@example.com' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  ;(PusherServer as any).mockReturnValue({ authorizeChannel })
  authorizeChannel.mockReturnValue({ auth: 'key:signature' })
})

describe('POST /api/pusher/auth', () => {
  it('refuses an unauthenticated caller', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await POST(req(VALID))
    expect(response.status).toBe(401)
    expect(authorizeChannel).not.toHaveBeenCalled()
  })

  it('requires both socket_id and channel_name', async () => {
    expect((await POST(req({ socket_id: '123.456' }))).status).toBe(400)
    expect((await POST(req({ channel_name: 'private-campaign-camp1' }))).status).toBe(400)
    expect(authorizeChannel).not.toHaveBeenCalled()
  })

  it('grants a campaign channel to a member', async () => {
    const response = await POST(req(VALID))
    expect(response.status).toBe(200)
    expect(authorizeChannel).toHaveBeenCalledWith('123.456', 'private-campaign-camp1')
    expect(await response.json()).toEqual({ auth: 'key:signature' })
  })

  it('refuses a campaign channel to a non-member', async () => {
    // The whole point. Campaign ids travel in the URL bar and in every
    // shared invite link, so knowing one was never a permission.
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await POST(req(VALID))
    expect(response.status).toBe(403)
    expect(authorizeChannel).not.toHaveBeenCalled()
  })

  it('grants a user channel only to that user', async () => {
    const mine = await POST(req({ socket_id: '123.456', channel_name: 'private-user-user1' }))
    expect(mine.status).toBe(200)

    authorizeChannel.mockClear()
    // This channel carries whispers and notification previews in
    // cleartext, and user ids are published to every member of a campaign
    // inside message payloads.
    const theirs = await POST(req({ socket_id: '123.456', channel_name: 'private-user-user2' }))
    expect(theirs.status).toBe(403)
    expect(authorizeChannel).not.toHaveBeenCalled()
  })

  it('does not let campaign membership authorise a user channel', async () => {
    // Being in a campaign with someone must never grant their private feed.
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    const response = await POST(req({ socket_id: '123.456', channel_name: 'private-user-user2' }))
    expect(response.status).toBe(403)
  })

  it('denies an unrecognised channel shape by default', async () => {
    // So a new private channel has to add its rule here rather than
    // inheriting a grant by accident.
    for (const channel of ['private-admin-everything', 'campaign-camp1', 'presence-campaign-camp1', '']) {
      authorizeChannel.mockClear()
      const response = await POST(req({ socket_id: '123.456', channel_name: channel }))
      expect(response.status, `channel ${channel || '(empty)'} must not be granted`).not.toBe(200)
      expect(authorizeChannel).not.toHaveBeenCalled()
    }
  })

  it('returns 503 rather than a fake grant when realtime is unconfigured', async () => {
    ;(PusherServer as any).mockReturnValue(null)
    const response = await POST(req(VALID))
    expect(response.status).toBe(503)
  })
})
