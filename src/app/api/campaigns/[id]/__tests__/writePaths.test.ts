// src/app/api/campaigns/[id]/__tests__/writePaths.test.ts
//
// The write paths (#95, second batch).
//
// The first batch covered the fog-gated reads — the claim the product leads
// with. These are the other half of the risk: the routes that spend money,
// mutate scene state, or hand out access. A read bug leaks; a write bug
// charges the wrong person, resolves a scene twice, or lets a player mint
// invitations to a campaign they do not run.
//
// Deliberately not happy-path tests. What matters on these routes is the
// GUARDS — who is refused, and (more importantly) that a refusal happens
// *before* the expensive or irreversible thing, not after it.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const resolveScene = vi.fn(async () => ({}))
const runWorldTurnIfDue = vi.fn(async () => ({ ran: false }))
const preflightSceneBilling = vi.fn(async () => ({ ok: true }))
const chargeForSceneResolution = vi.fn(async () => ({ charged: 0 }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignMembership: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    campaign: { findUnique: vi.fn() },
    scene: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(async () => ({})) },
    campaignInvite: { create: vi.fn(async () => ({ id: 'inv1', token: 't' })), findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/auth', () => ({
  getUser: vi.fn(),
  verifyAuth: vi.fn(),
  requireAuth: vi.fn(),
}))
// Rate limiting is exercised in its own suite; here it must never be the
// reason a guard appears to work.
vi.mock('@/lib/rateLimit', () => ({
  AI_ACTION_LIMIT: { bucket: 'ai-action', limit: 10, windowSeconds: 60 },
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  rateLimitExceededResponse: vi.fn(),
}))
vi.mock('@/lib/game/sceneResolver', () => ({
  resolveScene: (...a: unknown[]) => resolveScene(...(a as [])),
  getCurrentScene: vi.fn(async () => null),
}))
vi.mock('@/lib/game/worldTurn', () => ({
  runWorldTurnIfDue: (...a: unknown[]) => runWorldTurnIfDue(...(a as [])),
}))
vi.mock('@/lib/game/resolutionBilling', () => ({
  preflightSceneBilling: (...a: unknown[]) => preflightSceneBilling(...(a as [])),
  chargeForSceneResolution: (...a: unknown[]) => chargeForSceneResolution(...(a as [])),
}))

import { prisma } from '@/lib/prisma'
import { getUser, requireAuth } from '@/lib/auth'
import { POST as resolveSceneRoute } from '../resolve-scene/route'
import { POST as endSceneRoute } from '../end-scene/route'
import { POST as createInvite, GET as listInvites } from '../invites/route'
import { GET as getMembers } from '../members/route'

const db = prisma as any
const params = { params: { id: 'camp1' } }

const post = (body: unknown = {}) =>
  new NextRequest('http://localhost/api/campaigns/camp1/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const get = () => new NextRequest('http://localhost/api/campaigns/camp1/x')

const authAs = (role: string | null) => {
  const user = { userId: 'u1', email: 'p@example.com' }
  ;(getUser as any).mockResolvedValue(user)
  ;(requireAuth as any).mockResolvedValue(user)
  db.campaignMembership.findUnique.mockResolvedValue(role ? { id: 'm1', role, userId: 'u1' } : null)
  db.campaign.findUnique.mockResolvedValue({
    id: 'camp1',
    memberships: role ? [{ userId: 'u1', role }] : [],
  })
}

const unauthenticated = () => {
  ;(getUser as any).mockResolvedValue(null)
  ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveScene.mockResolvedValue({} as never)
  runWorldTurnIfDue.mockResolvedValue({ ran: false } as never)
  preflightSceneBilling.mockResolvedValue({ ok: true } as never)
  db.scene.findUnique.mockResolvedValue({
    id: 's1', campaignId: 'camp1', status: 'AWAITING_ACTIONS', playerActions: [{ id: 'a1' }],
  })
  db.scene.findFirst.mockResolvedValue({
    id: 's1', campaignId: 'camp1', sceneNumber: 1, status: 'AWAITING_ACTIONS', playerActions: [{ id: 'a1' }],
  })
})

describe('POST /resolve-scene — force-resolving is the host\'s call', () => {
  it('refuses a player, without spending anything', async () => {
    // The most expensive route in the app. A 403 that arrives after the
    // LLM call has already run is not a 403 that saved anyone money.
    authAs('PLAYER')
    const res = await resolveSceneRoute(post({ sceneId: 's1' }), params)

    expect(res.status).toBe(403)
    expect(resolveScene).not.toHaveBeenCalled()
  })

  it('refuses a non-member', async () => {
    authAs(null)
    const res = await resolveSceneRoute(post({ sceneId: 's1' }), params)

    expect(res.status).toBe(403)
    expect(resolveScene).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller', async () => {
    unauthenticated()
    const res = await resolveSceneRoute(post({ sceneId: 's1' }), params)

    expect(res.status).toBe(401)
    expect(resolveScene).not.toHaveBeenCalled()
  })

  it('404s a scene belonging to another campaign', async () => {
    // The scene id comes from the request body, so this is the check that
    // stops a host resolving someone else's scene.
    authAs('ADMIN')
    db.scene.findFirst.mockResolvedValue(null)

    const res = await resolveSceneRoute(post({ sceneId: 'someone-elses' }), params)

    expect(res.status).toBe(404)
    expect(resolveScene).not.toHaveBeenCalled()
  })

  it('refuses to resolve a scene nobody has acted in', async () => {
    authAs('ADMIN')
    db.scene.findFirst.mockResolvedValue({ id: 's1', campaignId: 'camp1', sceneNumber: 1, playerActions: [] })

    const res = await resolveSceneRoute(post({ sceneId: 's1' }), params)

    expect(res.status).toBe(400)
    expect(resolveScene).not.toHaveBeenCalled()
  })
})

describe('POST /end-scene — any member may end it, and pays for it', () => {
  it('lets an ordinary player end the scene', async () => {
    // Deliberate product decision, not an oversight: there is no human GM,
    // so pacing belongs to the table. The route comment says so, and this
    // pins it — a future "tighten this to admins" would fail here and have
    // to be a decision rather than a drive-by.
    authAs('PLAYER')
    const res = await endSceneRoute(post({ sceneId: 's1' }), params)

    expect(res.status).not.toBe(403)
    expect(resolveScene).toHaveBeenCalled()
  })

  it('force-resolves and signals is_scene_ending, even if not everyone acted', async () => {
    // The bug this pins: end-scene used to call resolveScene with no
    // forceResolve flag, so ending before everyone acted threw, was
    // swallowed by the route's own try/catch, and the scene silently
    // flipped to RESOLVED with zero narration. forceResolve:true fixes
    // that; isSceneEnding:true (the 4th arg) is the separate signal that
    // makes the model actually wrap up the scene's thread instead of
    // leaving it open, per scenePrompt.ts's <scene_ending> section.
    authAs('PLAYER')
    await endSceneRoute(post({ sceneId: 's1' }), params)

    expect(resolveScene).toHaveBeenCalledWith('camp1', 's1', true, true)
  })

  it('refuses a non-member', async () => {
    authAs(null)
    const res = await endSceneRoute(post({ sceneId: 's1' }), params)

    expect(res.status).toBe(403)
    expect(resolveScene).not.toHaveBeenCalled()
  })

  it('does not spend AI budget when the billing preflight fails', async () => {
    // The one that costs real money. A 402 returned *after* resolveScene
    // has run means the user was refused service and billed for it.
    authAs('PLAYER')
    preflightSceneBilling.mockResolvedValue({ ok: false, error: 'Insufficient balance' } as never)

    const res = await endSceneRoute(post({ sceneId: 's1' }), params)

    expect(res.status).toBe(402)
    expect(resolveScene).not.toHaveBeenCalled()
    expect(runWorldTurnIfDue).not.toHaveBeenCalled()
  })

  it('refuses to end a scene twice', async () => {
    authAs('PLAYER')
    db.scene.findUnique.mockResolvedValue({
      id: 's1', campaignId: 'camp1', status: 'RESOLVED', playerActions: [{ id: 'a1' }],
    })

    const res = await endSceneRoute(post({ sceneId: 's1' }), params)

    expect(res.status).toBe(400)
    expect(resolveScene).not.toHaveBeenCalled()
  })

  it('404s a scene from another campaign, before billing it', async () => {
    authAs('PLAYER')
    db.scene.findUnique.mockResolvedValue({ id: 's1', campaignId: 'other', status: 'AWAITING_ACTIONS', playerActions: [] })

    const res = await endSceneRoute(post({ sceneId: 's1' }), params)

    expect(res.status).toBe(404)
    expect(preflightSceneBilling).not.toHaveBeenCalled()
  })
})

describe('/invites — handing out access is admin-only', () => {
  it('refuses a player creating an invite', async () => {
    // An escalation if it were wrong: any member could invite anyone into
    // a campaign they do not run.
    authAs('PLAYER')
    const res = await createInvite(post({}), params)

    expect(res.status).toBe(403)
    expect(db.campaignInvite.create).not.toHaveBeenCalled()
  })

  it('refuses a non-member creating an invite', async () => {
    authAs(null)
    const res = await createInvite(post({}), params)

    expect(res.status).toBe(403)
    expect(db.campaignInvite.create).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller', async () => {
    unauthenticated()
    const res = await createInvite(post({}), params)

    expect(res.status).toBe(401)
    expect(db.campaignInvite.create).not.toHaveBeenCalled()
  })

  it('lets a host create one', async () => {
    authAs('ADMIN')
    const res = await createInvite(post({}), params)

    expect(res.status).toBe(200)
    expect(db.campaignInvite.create).toHaveBeenCalled()
  })

  it('does not list existing invite tokens to a player', async () => {
    // Listing is as sensitive as creating: an invite token IS the access.
    authAs('PLAYER')
    const res = await listInvites(get(), params)

    expect(res.status).toBe(403)
    expect(db.campaignInvite.findMany).not.toHaveBeenCalled()
  })
})

describe('GET /members — the roster is for members', () => {
  it('refuses a non-member', async () => {
    authAs(null)
    const res = await getMembers(get(), params)
    expect(res.status).toBe(403)
  })

  it('refuses an unauthenticated caller', async () => {
    unauthenticated()
    const res = await getMembers(get(), params)
    expect(res.status).toBe(401)
  })
})
