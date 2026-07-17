// src/app/api/campaigns/[id]/scenes/[sceneId]/resume/__tests__/route.test.ts
// Admin-only endpoint to resume a scene paused by an X-Card.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignMembership: { findUnique: vi.fn() },
    scene: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))
vi.mock('@/lib/safety/safety-service', () => ({
  SafetyService: { resumeScene: vi.fn() },
}))

import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { SafetyService } from '@/lib/safety/safety-service'
import { POST } from '../route'

const db = prisma as any

function call() {
  const request = new NextRequest('http://localhost/api/campaigns/camp1/scenes/scene1/resume', {
    method: 'POST',
  })
  return POST(request, { params: { id: 'camp1', sceneId: 'scene1' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockReturnValue({ userId: 'user1', email: 'user1@example.com' })
})

describe('POST resume', () => {
  it('rejects a non-admin', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'PLAYER' })
    const response = await call()
    expect(response.status).toBe(403)
    expect(SafetyService.resumeScene).not.toHaveBeenCalled()
  })

  it('404s when the scene does not belong to the campaign', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'ADMIN' })
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'other-campaign', isPaused: true })
    const response = await call()
    expect(response.status).toBe(404)
  })

  it('400s when the scene is not actually paused', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'ADMIN' })
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'camp1', isPaused: false })
    const response = await call()
    expect(response.status).toBe(400)
    expect(SafetyService.resumeScene).not.toHaveBeenCalled()
  })

  it('resumes a paused scene for an admin', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'ADMIN' })
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'camp1', isPaused: true })
    ;(SafetyService.resumeScene as any).mockResolvedValue({ isPaused: false })

    const response = await call()

    expect(response.status).toBe(200)
    expect(SafetyService.resumeScene).toHaveBeenCalledWith('scene1')
  })
})
