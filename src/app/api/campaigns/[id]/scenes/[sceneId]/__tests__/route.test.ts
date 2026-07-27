// src/app/api/campaigns/[id]/scenes/[sceneId]/__tests__/route.test.ts
// Admin-only permanent scene deletion, at any point in the scene's life.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignMembership: { findUnique: vi.fn() },
    scene: { findUnique: vi.fn(), delete: vi.fn() },
  },
}))
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))
vi.mock('@/lib/realtime/pusher-server', () => ({
  default: vi.fn(() => null),
}))

import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { DELETE } from '../route'

const db = prisma as any

function call() {
  const request = new NextRequest('http://localhost/api/campaigns/camp1/scenes/scene1', {
    method: 'DELETE',
  })
  return DELETE(request, { params: { id: 'camp1', sceneId: 'scene1' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockReturnValue({ userId: 'user1', email: 'user1@example.com' })
})

describe('DELETE scene', () => {
  it('rejects a non-admin', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'PLAYER' })
    const response = await call()
    expect(response.status).toBe(403)
    expect(db.scene.delete).not.toHaveBeenCalled()
  })

  it('404s when the scene does not belong to the campaign', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'ADMIN' })
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'other-campaign' })
    const response = await call()
    expect(response.status).toBe(404)
  })

  it('404s when the scene does not exist', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'ADMIN' })
    db.scene.findUnique.mockResolvedValue(null)
    const response = await call()
    expect(response.status).toBe(404)
  })

  it('deletes an untouched scene for an admin', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'ADMIN' })
    db.scene.findUnique.mockResolvedValue({
      id: 'scene1', campaignId: 'camp1', sceneNumber: 3,
      sceneResolutionText: null,
    })
    db.scene.delete.mockResolvedValue({ id: 'scene1' })

    const response = await call()

    expect(response.status).toBe(200)
    expect(db.scene.delete).toHaveBeenCalledWith({ where: { id: 'scene1' } })
    const body = await response.json()
    expect(body).toEqual({ success: true, sceneId: 'scene1' })
  })

  it('deletes a scene that already has actions and a resolution', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'ADMIN' })
    db.scene.findUnique.mockResolvedValue({
      id: 'scene1', campaignId: 'camp1', sceneNumber: 1,
      sceneResolutionText: 'It happened.',
    })
    db.scene.delete.mockResolvedValue({ id: 'scene1' })

    const response = await call()

    expect(response.status).toBe(200)
    expect(db.scene.delete).toHaveBeenCalledWith({ where: { id: 'scene1' } })
  })
})
