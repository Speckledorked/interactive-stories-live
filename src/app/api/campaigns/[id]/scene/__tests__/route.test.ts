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
    character: { findUnique: vi.fn(), findMany: vi.fn() },
    scene: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    playerAction: { create: vi.fn(), findMany: vi.fn() },
    campaignMembership: { findMany: vi.fn(), findUnique: vi.fn() },
    sceneImage: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))
vi.mock('@/lib/realtime/pusher-server', () => ({
  PusherServer: vi.fn(() => ({ trigger: vi.fn().mockResolvedValue(undefined) })),
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
  recoverStaleJobs: vi.fn().mockResolvedValue(undefined),
}))

import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rateLimit'
import { moderatePlayerText } from '@/lib/ai/moderation'
import { enqueueSceneResolution } from '@/lib/game/resolutionQueue'
import { GET, POST } from '../route'

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
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockReturnValue({ userId: 'user1', email: 'user1@example.com' })
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true, remaining: 9, retryAfterSeconds: 0 })
  ;(moderatePlayerText as any).mockResolvedValue({ flagged: false, categories: [] })
  db.campaign.findUnique.mockResolvedValue({ contentModerationLevel: 'standard' })
  db.character.findUnique.mockResolvedValue({ id: 'char1', userId: 'user1' })
  // Default: the caller is the only living character in the campaign, so
  // an open scene's "whole party" is just them — resolves immediately,
  // same as before this was made to actually wait. Tests that care about
  // a bigger living roster override this.
  db.character.findMany.mockResolvedValue([{ userId: 'user1' }])
  // Default: every userId submitPlayerAction checks membership for is an
  // active member — matches every test's implicit assumption from before
  // this filter existed. Echoes back whatever was queried rather than a
  // fixed list, so it stays correct as tests below override the living
  // roster to include user2/etc. without each needing its own override.
  db.campaignMembership.findMany.mockImplementation(({ where }: any) =>
    Promise.resolve((where?.userId?.in ?? []).map((userId: string) => ({ userId })))
  )
  db.scene.findUnique.mockResolvedValue(makeBaseScene())
  db.scene.findMany.mockResolvedValue([])
  db.scene.update.mockResolvedValue({})
  db.scene.updateMany.mockResolvedValue({ count: 1 })
  db.campaignMembership.findUnique.mockResolvedValue({ userId: 'user1', campaignId: 'camp1', role: 'PLAYER' })
  db.sceneImage.findMany.mockResolvedValue([])
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

  it('creates the action and resolves immediately for an open scene with only one living character', async () => {
    // The just-created action now shows up in the current-exchange query.
    db.playerAction.findMany.mockResolvedValue([{ userId: 'user1' }])

    const response = await call()

    expect(response.status).toBe(201)
    expect(db.playerAction.create).toHaveBeenCalledTimes(1)
    expect(enqueueSceneResolution).toHaveBeenCalledWith('camp1', 'scene1')
  })

  it('waits for the rest of a living party in an open scene instead of resolving on the first action', async () => {
    // Two living characters, two different owners — only user1 has acted.
    db.character.findMany.mockResolvedValue([{ userId: 'user1' }, { userId: 'user2' }])
    db.playerAction.findMany.mockResolvedValue([{ userId: 'user1' }])

    const response = await call()

    expect(response.status).toBe(201)
    expect(enqueueSceneResolution).not.toHaveBeenCalled()
    expect(db.scene.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { waitingOnUsers: ['user2'] } })
    )
  })

  it('resolves an open scene once every living character has submitted', async () => {
    db.character.findMany.mockResolvedValue([{ userId: 'user1' }, { userId: 'user2' }])
    db.playerAction.findMany.mockResolvedValue([{ userId: 'user1' }, { userId: 'user2' }])

    const response = await call()

    expect(response.status).toBe(201)
    expect(enqueueSceneResolution).toHaveBeenCalledWith('camp1', 'scene1')
  })

  it('waits for the rest of the party instead of resolving when participants are defined and incomplete', async () => {
    db.scene.findUnique.mockResolvedValue({
      ...makeBaseScene(),
      participants: { characterIds: ['char1', 'char2'], userIds: ['user1', 'user2'], scoped: true },
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

  it("rejects a character that isn't in the scene's explicit participant list (split-party / Character-Focused scene)", async () => {
    db.scene.findUnique.mockResolvedValue({
      ...makeBaseScene(),
      // char1 (the caller's character) deliberately left out — the GM
      // scoped this scene to char2/char3 only.
      participants: { characterIds: ['char2', 'char3'], userIds: ['user2', 'user3'], scoped: true },
    })

    const response = await call()

    expect(response.status).toBe(403)
    expect(db.playerAction.create).not.toHaveBeenCalled()
    expect(db.scene.update).not.toHaveBeenCalled()
  })

  it('enqueues resolution once every defined participant has submitted', async () => {
    db.scene.findUnique.mockResolvedValue({
      ...makeBaseScene(),
      participants: { characterIds: ['char1', 'char2'], userIds: ['user1', 'user2'], scoped: true },
    })
    db.playerAction.findMany.mockResolvedValue([{ userId: 'user1' }, { userId: 'user2' }])

    const response = await call()

    expect(response.status).toBe(201)
    expect(enqueueSceneResolution).toHaveBeenCalledWith('camp1', 'scene1')
  })

  it("does not reject a second player from an open scene whose first joiner already made it a non-empty participants object", async () => {
    // Regression: an open scene's participants starts null and gains a
    // {characterIds, userIds} shape (scoped left false/absent) the moment
    // its first player acts — that must not make the scene look "closed"
    // to everyone else. Two living characters, only char1 has joined so
    // far; char2 (a different user) submitting now must succeed, not 403.
    ;(requireAuth as any).mockReturnValue({ userId: 'user2', email: 'user2@example.com' })
    db.scene.findUnique.mockResolvedValue({
      ...makeBaseScene(),
      participants: { characterIds: ['char1'], userIds: ['user1'] },
    })
    db.character.findUnique.mockResolvedValue({ id: 'char2', userId: 'user2' })
    db.character.findMany.mockResolvedValue([{ userId: 'user1' }, { userId: 'user2' }])
    // Only char2's action (the one this request just created) is pending
    // this exchange — char1/user1 hasn't acted yet this round, even
    // though they're already in participants from an earlier exchange.
    db.playerAction.findMany.mockResolvedValue([{ userId: 'user2' }])

    const response = await call({ sceneId: 'scene1', characterId: 'char2', actionText: 'I follow.' })

    expect(response.status).toBe(201)
    expect(db.playerAction.create).toHaveBeenCalledTimes(1)
    expect(enqueueSceneResolution).not.toHaveBeenCalled()
    // Waits on the full living roster minus who's submitted this exchange
    // — not just whoever happened to already be in participants.
    expect(db.scene.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { waitingOnUsers: ['user1'] } })
    )
  })
})

describe('GET /api/campaigns/[id]/scene — sceneImage attachment', () => {
  // SceneImage.sceneId is a plain indexed string, not a Prisma relation
  // (see the schema comment), so route.ts fetches it separately and
  // merges it in rather than riding along in scene.findMany's `include`.
  const call = () => GET(new NextRequest('http://localhost/api/campaigns/camp1/scene'), { params: { id: 'camp1' } })

  function makeActiveScene(id: string) {
    return {
      id,
      campaignId: 'camp1',
      status: 'AWAITING_ACTIONS',
      sceneNumber: 1,
      playerActions: [],
      gmClarifications: [],
    }
  }

  it('attaches sceneImage status/url when a row exists for the scene', async () => {
    db.scene.findMany.mockResolvedValue([makeActiveScene('scene1')])
    db.sceneImage.findMany.mockResolvedValue([
      { sceneId: 'scene1', status: 'COMPLETED', imageUrl: 'https://blob.example/scene1.png' },
    ])

    const response = await call()
    const body = await response.json()

    expect(db.sceneImage.findMany).toHaveBeenCalledWith({
      where: { sceneId: { in: ['scene1'] } },
      select: { sceneId: true, status: true, imageUrl: true },
    })
    expect(body.scene.sceneImage).toEqual({ sceneId: 'scene1', status: 'COMPLETED', imageUrl: 'https://blob.example/scene1.png' })
    expect(body.scenes[0].sceneImage).toEqual({ sceneId: 'scene1', status: 'COMPLETED', imageUrl: 'https://blob.example/scene1.png' })
  })

  it('attaches sceneImage: null when no row exists for the scene', async () => {
    db.scene.findMany.mockResolvedValue([makeActiveScene('scene1')])
    db.sceneImage.findMany.mockResolvedValue([])

    const response = await call()
    const body = await response.json()

    expect(body.scene.sceneImage).toBeNull()
  })

  it('degrades gracefully — still returns scenes — if the sceneImage lookup fails', async () => {
    db.scene.findMany.mockResolvedValue([makeActiveScene('scene1')])
    db.sceneImage.findMany.mockRejectedValue(new Error('db unreachable'))

    const response = await call()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.scene.id).toBe('scene1')
  })

  it('skips the lookup entirely when there are no active scenes', async () => {
    db.scene.findMany.mockResolvedValue([])

    const response = await call()
    const body = await response.json()

    expect(db.sceneImage.findMany).not.toHaveBeenCalled()
    expect(body.scene).toBeNull()
    expect(body.scenes).toEqual([])
  })
})
