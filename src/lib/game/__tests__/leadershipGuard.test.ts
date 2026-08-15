// src/lib/game/__tests__/leadershipGuard.test.ts
// #275: shared cross-check for the "at most one leader either way"
// invariant, called from both the NPC create and update routes before
// either ever writes factionRole: 'LEADER'.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { factionFindUniqueMock, npcUpdateManyMock } = vi.hoisted(() => ({
  factionFindUniqueMock: vi.fn(),
  npcUpdateManyMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    faction: { findUnique: factionFindUniqueMock },
    nPC: { updateMany: npcUpdateManyMock },
  },
}))

import { guardNpcLeaderAssignment } from '../leadershipGuard'

beforeEach(() => {
  vi.clearAllMocks()
  npcUpdateManyMock.mockResolvedValue({ count: 0 })
})

describe('guardNpcLeaderAssignment', () => {
  it('rejects when the faction already has a player-character leader', async () => {
    factionFindUniqueMock.mockResolvedValue({ leaderCharacterId: 'char1' })
    const result = await guardNpcLeaderAssignment('camp1', 'f1', null)
    expect(result.ok).toBe(false)
    expect(npcUpdateManyMock).not.toHaveBeenCalled()
  })

  it('auto-demotes an existing living NPC LEADER on the same faction', async () => {
    factionFindUniqueMock.mockResolvedValue({ leaderCharacterId: null })
    const result = await guardNpcLeaderAssignment('camp1', 'f1', null)
    expect(result.ok).toBe(true)
    expect(npcUpdateManyMock).toHaveBeenCalledWith({
      where: { campaignId: 'camp1', factionId: 'f1', factionRole: 'LEADER', isAlive: true },
      data: { factionRole: 'MEMBER' },
    })
  })

  it('excludes the NPC being updated from its own conflict check', async () => {
    factionFindUniqueMock.mockResolvedValue({ leaderCharacterId: null })
    await guardNpcLeaderAssignment('camp1', 'f1', 'npc1')
    expect(npcUpdateManyMock).toHaveBeenCalledWith({
      where: { campaignId: 'camp1', factionId: 'f1', factionRole: 'LEADER', isAlive: true, id: { not: 'npc1' } },
      data: { factionRole: 'MEMBER' },
    })
  })

  it('succeeds with no faction row found (defensive — the caller\'s own write will 404/fail on its own scoped where)', async () => {
    factionFindUniqueMock.mockResolvedValue(null)
    const result = await guardNpcLeaderAssignment('camp1', 'missing', null)
    expect(result.ok).toBe(true)
  })
})
