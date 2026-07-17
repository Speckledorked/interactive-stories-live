// src/app/api/campaigns/[id]/scene/__tests__/route.test.ts
// Route-level: the core turn loop's entry point — auth, rate limiting,
// moderation, ownership checks, and the open-scene vs. defined-participant
// branches that decide whether resolution enqueues immediately or waits.
// The resolution pipeline itself has its own extensive unit coverage
// (sceneResolver.test.ts, resolutionQueue.test.ts); this exercises the
// route handler that fronts it.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    character: { findUnique: vi.fn() },
    scene: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    playerAction: { create: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))
vi.mock('@/lib/pusher', () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/lib/rateLimit', () => ({
  AI_ACTION_LIMIT: { bucket: 'ai-action', limit: 10, windowSeconds: 60 },
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 9, retryAfterSeconds: 0 }),
  rateLimitExceededResponse: (result: any) =>
    new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
}))
vi.mock('@/lib/ai/moderation', () => ({
  moderatePlayerText: vi.fn().mockResolvedValue({ flagged: false, categories: [] }),
}))
vi.mock('@/lib/analytics/events', () => ({
  recordEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/game/exchange-manager', () => ({
  ExchangeManager: vi.fn().mockImplementation(function (this: any) {
    this.recordAction = vi.fn().mockResolvedValue(undefined)
  }),
}))
vi.mock('@/lib/game/resolutionQueue', () => ({
  enqueueSceneResolution: vi.fn().mockResolvedValue(undefined),
}))

import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rateLimit'
import { moderatePlayerText } from '@/lib/ai/moderation'
import { enqueueSceneResolution } from '@/lib/game/resolutionQueue'
import { POST } from '../route'

const db = prisma as any

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = { sceneId: 'scene1', characterId: 'char1', actionText: 'I draw my sword.' }

function makeBaseScene() {
  return {
    id: 'scene1',
    campaignId: 'camp1',
    status: 'AWAITING_ACTIONS',
    currentExchange: 0,
    // null, not an empty object: the route only takes the "open scene,
    // resolve immediately" branch when participants was never set at all.
    // An empty { characterIds: [], userIds: [] } gets mutated in place by
    // the very first submitted action (same object reference), so it
    // reads as "defined participants" by the time that branch is checked.
    participants: null as { characterIds: string[]; userIds: string[] } | null,
    playerActions: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockReturnValue({ userId: 'user1', email: 'user1@example.com' })
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true, remaining: 9, retryAfterSeconds: 0 })
  ;(moderatePlayerText as any).mockResolvedValue({ flagged: false, categories: [] })
  db.campaign.findUnique.mockResolvedValue({ contentModerationLevel: 'standard' })
  db.character.findUnique.mockResolvedValue({ id: 'char1', userId: 'user1' })
  db.scene.findUnique.mockResolvedValue(makeBaseScene())
  db.scene.findMany.mockResolvedValue([])
  db.scene.update.mockResolvedValue({})
  db.playerAction.create.mockResolvedValue({
    id: 'action1',
    sceneId: 'scene1',
    characterId: 'char1',
    userId: 'user1',
    actionText: 'I draw my sword.',
    createdAt: new Date(),
    character: { id: 'char1', name: 'Hero' },
    user: { id: 'user1', email: 'user1@example.com' },
  })
  db.playerAction.findMany.mockResolvedValue([])
})

describe('POST /api/campaigns/[id]/scene', () => {
  const call = (body: unknown = validBody) => POST(makeRequest(body), { params: { id: 'camp1' } })

  it('rejects an unauthenticated request', async () => {
    ;(requireAuth as any).mockImplementation(() => { throw new Error('Unauthorized') })
    const response = await call()
    expect(response.status).toBe(401)
  })

  it('rejects a request missing required fields', async () => {
    const response = await call({ sceneId: 'scene1' })
    expect(response.status).toBe(400)
    expect(db.playerAction.create).not.toHaveBeenCalled()
  })

  it('is rate limited before touching moderation or the DB action write', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 })
    const response = await call()
    expect(response.status).toBe(429)
    expect(moderatePlayerText).not.toHaveBeenCalled()
    expect(db.playerAction.create).not.toHaveBeenCalled()
  })

  it('blocks action text flagged by moderation before it ever reaches an AI GM call', async () => {
    ;(moderatePlayerText as any).mockResolvedValue({ flagged: true, categories: ['violence'] })
    const response = await call()
    expect(response.status).toBe(400)
    expect(db.playerAction.create).not.toHaveBeenCalled()
  })

  it("rejects a character that isn't the caller's own", async () => {
    db.character.findUnique.mockResolvedValue({ id: 'char1', userId: 'someone-else' })
    const response = await call()
    expect(response.status).toBe(403)
  })

  it('rejects submitting to a scene that is not accepting actions', async () => {
    db.scene.findUnique.mockResolvedValue({ ...makeBaseScene(), status: 'RESOLVING' })
    const response = await call()
    expect(response.status).toBe(400)
  })

  it('rejects submitting to a scene paused by an X-Card', async () => {
    db.scene.findUnique.mockResolvedValue({ ...makeBaseScene(), isPaused: true })
    const response = await call()
    expect(response.status).toBe(423)
    expect(db.playerAction.create).not.toHaveBeenCalled()
  })

  it('creates the action and enqueues resolution immediately for an open scene', async () => {
    const response = await call()

    expect(response.status).toBe(201)
    expect(db.playerAction.create).toHaveBeenCalledTimes(1)
    expect(enqueueSceneResolution).toHaveBeenCalledWith('camp1', 'scene1')
  })

  it('waits for the rest of the party instead of resolving when participants are defined and incomplete', async () => {
    db.scene.findUnique.mockResolvedValue({
      ...makeBaseScene(),
      participants: { characterIds: ['char1', 'char2'], userIds: ['user1', 'user2'] },
    })
    // Only user1's action has landed so far this exchange.
    db.playerAction.findMany.mockResolvedValue([{ userId: 'user1' }])

    const response = await call()

    expect(response.status).toBe(201)
    expect(enqueueSceneResolution).not.toHaveBeenCalled()
    expect(db.scene.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { waitingOnUsers: ['user2'] } })
    )
  })

  it('enqueues resolution once every defined participant has submitted', async () => {
    db.scene.findUnique.mockResolvedValue({
      ...makeBaseScene(),
      participants: { characterIds: ['char1', 'char2'], userIds: ['user1', 'user2'] },
    })
    db.playerAction.findMany.mockResolvedValue([{ userId: 'user1' }, { userId: 'user2' }])

    const response = await call()

    expect(response.status).toBe(201)
    expect(enqueueSceneResolution).toHaveBeenCalledWith('camp1', 'scene1')
  })
})
