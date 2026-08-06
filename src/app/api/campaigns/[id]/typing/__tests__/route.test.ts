// src/app/api/campaigns/[id]/typing/__tests__/route.test.ts
// #135 (cont.) — the typing indicator had no test coverage: the
// membership gate, and coercing an arbitrary isTyping value to a real
// boolean before broadcasting it, were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/realtime/pusher-server', () => ({ triggerUserTyping: vi.fn() }))

import { verifyAuth } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { triggerUserTyping } from '@/lib/realtime/pusher-server'
import { POST } from '../route'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/typing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'player1', email: 'player1@example.com' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await POST(req({ isTyping: true }), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
    expect(triggerUserTyping).not.toHaveBeenCalled()
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await POST(req({ isTyping: true }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(triggerUserTyping).not.toHaveBeenCalled()
  })

  it('broadcasts a real boolean even if the client sends something else', async () => {
    const response = await POST(req({ isTyping: 'yes' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(200)
    expect(triggerUserTyping).toHaveBeenCalledWith('camp1', 'player1', 'player1@example.com', true)
  })

  it('broadcasts false when isTyping is omitted', async () => {
    await POST(req({}), { params: { id: 'camp1' } })
    expect(triggerUserTyping).toHaveBeenCalledWith('camp1', 'player1', 'player1@example.com', false)
  })

  it('returns 500 on an unexpected error', async () => {
    ;(triggerUserTyping as any).mockRejectedValue(new Error('pusher down'))
    const response = await POST(req({ isTyping: true }), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
