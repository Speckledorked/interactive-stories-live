// src/app/api/characters/[id]/dynamic-downtime/suggestions/__tests__/route.test.ts
// #135 (cont.) — the personalized downtime suggestions read had no test
// coverage: the auth gate was unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/downtime/ai-downtime-service', () => ({
  AIDrivenDowntimeService: { getPersonalizedSuggestions: vi.fn() },
}))

import { verifyAuth } from '@/lib/auth'
import { AIDrivenDowntimeService } from '@/lib/downtime/ai-downtime-service'
import { GET } from '../route'

function req() {
  return new NextRequest('http://localhost/api/characters/char1/dynamic-downtime/suggestions')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'player1' })
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'char1' } })
    expect(response.status).toBe(401)
    expect(AIDrivenDowntimeService.getPersonalizedSuggestions).not.toHaveBeenCalled()
  })

  it('returns suggestions for the character', async () => {
    ;(AIDrivenDowntimeService.getPersonalizedSuggestions as any).mockResolvedValue(['Learn a trade'])
    const response = await GET(req(), { params: { id: 'char1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ suggestions: ['Learn a trade'] })
    expect(AIDrivenDowntimeService.getPersonalizedSuggestions).toHaveBeenCalledWith('char1')
  })

  it('returns 500 on an unexpected error', async () => {
    ;(AIDrivenDowntimeService.getPersonalizedSuggestions as any).mockRejectedValue(new Error('AI down'))
    const response = await GET(req(), { params: { id: 'char1' } })
    expect(response.status).toBe(500)
  })
})
