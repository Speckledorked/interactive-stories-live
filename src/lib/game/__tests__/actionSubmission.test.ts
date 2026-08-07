// src/lib/game/__tests__/actionSubmission.test.ts
// submitPlayerAction's "has the whole party acted" gate. Focused on the
// membership-filtering fix: a removed/banned member's Character row is
// never touched (removing someone shouldn't narratively kill their
// character), so without filtering by active CampaignMembership, a
// departed player's still-"alive" character would count as required
// forever — nobody left who could ever submit that action, silently
// stalling the scene until a GM manually force-resolved it.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    scene: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    playerAction: { create: vi.fn(), findMany: vi.fn() },
    character: { findMany: vi.fn() },
    campaignMembership: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/realtime/pusher-server', () => ({ PusherServer: vi.fn(() => null) }))
vi.mock('@/lib/analytics/events', () => ({ recordEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/game/exchange-manager', () => ({
  ExchangeManager: vi.fn().mockImplementation(() => ({ recordAction: vi.fn().mockResolvedValue(undefined) })),
}))
vi.mock('@/lib/game/resolutionQueue', () => ({ enqueueSceneResolution: vi.fn().mockResolvedValue(undefined) }))

import { prisma } from '@/lib/prisma'
import { submitPlayerAction, type SceneParticipants } from '../actionSubmission'
import { enqueueSceneResolution } from '../resolutionQueue'

function makeScene(overrides: Record<string, unknown> = {}) {
  return {
    id: 'scene1',
    campaignId: 'camp1',
    currentExchange: 0,
    updatedAt: new Date(),
    participants: { characterIds: ['charA', 'charB'], userIds: ['userA', 'userB'], scoped: false },
    ...overrides,
  } as any
}

const baseAction = {
  id: 'action1',
  sceneId: 'scene1',
  character: { id: 'charA', name: 'Kess' },
  user: { id: 'userA', email: 'a@test.com' },
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(prisma.playerAction.create as any).mockResolvedValue(baseAction)
  ;(prisma.scene.update as any).mockResolvedValue({})
})

describe('submitPlayerAction — active-membership filtering (open scene)', () => {
  it('does not resolve while an active member has not yet submitted', async () => {
    ;(prisma.character.findMany as any).mockResolvedValue([{ userId: 'userA' }, { userId: 'userB' }])
    ;(prisma.campaignMembership.findMany as any).mockResolvedValue([{ userId: 'userA' }, { userId: 'userB' }])
    ;(prisma.playerAction.findMany as any).mockResolvedValue([{ userId: 'userA' }])

    const participants: SceneParticipants = { characterIds: ['charA', 'charB'], userIds: ['userA', 'userB'], scoped: false }
    await submitPlayerAction('camp1', 'userA', 'charA', 'I look around.', makeScene(), participants)

    expect(enqueueSceneResolution).not.toHaveBeenCalled()
    expect(prisma.scene.update).toHaveBeenCalledWith({ where: { id: 'scene1' }, data: { waitingOnUsers: ['userB'] } })
  })

  it('resolves once every ACTIVE member has submitted, even with other members still pending', async () => {
    ;(prisma.character.findMany as any).mockResolvedValue([{ userId: 'userA' }, { userId: 'userB' }])
    ;(prisma.campaignMembership.findMany as any).mockResolvedValue([{ userId: 'userA' }, { userId: 'userB' }])
    ;(prisma.playerAction.findMany as any).mockResolvedValue([{ userId: 'userA' }, { userId: 'userB' }])

    const participants: SceneParticipants = { characterIds: ['charA', 'charB'], userIds: ['userA', 'userB'], scoped: false }
    await submitPlayerAction('camp1', 'userA', 'charA', 'I look around.', makeScene(), participants)

    expect(enqueueSceneResolution).toHaveBeenCalledWith('camp1', 'scene1')
  })

  it("a departed member's still-alive character no longer blocks resolution", async () => {
    // userB's Character row is still isAlive:true (removal doesn't touch
    // it), but they no longer have a CampaignMembership row.
    ;(prisma.character.findMany as any).mockResolvedValue([{ userId: 'userA' }, { userId: 'userB' }])
    ;(prisma.campaignMembership.findMany as any).mockResolvedValue([{ userId: 'userA' }]) // userB filtered out
    ;(prisma.playerAction.findMany as any).mockResolvedValue([{ userId: 'userA' }])

    const participants: SceneParticipants = { characterIds: ['charA', 'charB'], userIds: ['userA', 'userB'], scoped: false }
    await submitPlayerAction('camp1', 'userA', 'charA', 'I look around.', makeScene(), participants)

    expect(enqueueSceneResolution).toHaveBeenCalledWith('camp1', 'scene1')
  })
})

describe('submitPlayerAction — active-membership filtering (scoped/split-party scene)', () => {
  it("filters a departed member out of a scoped scene's fixed roster too", async () => {
    ;(prisma.campaignMembership.findMany as any).mockResolvedValue([{ userId: 'userA' }]) // userB departed
    ;(prisma.playerAction.findMany as any).mockResolvedValue([{ userId: 'userA' }])

    const participants: SceneParticipants = { characterIds: ['charA', 'charB'], userIds: ['userA', 'userB'], scoped: true }
    await submitPlayerAction(
      'camp1',
      'userA',
      'charA',
      'I look around.',
      makeScene({ participants }),
      participants
    )

    // character.findMany must never be consulted for a scoped scene — its
    // roster is the fixed participants list, not "every living character".
    expect(prisma.character.findMany).not.toHaveBeenCalled()
    expect(enqueueSceneResolution).toHaveBeenCalledWith('camp1', 'scene1')
  })
})
