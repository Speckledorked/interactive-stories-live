// src/lib/game/__tests__/resolveActionMechanics.test.ts
//
// The roll ORCHESTRATOR, which had no coverage at all.
//
// resolution.test.ts covers computeMechanics and the pure modifier
// helpers thoroughly, and stops at the door of the function that actually
// runs during play: the one that loads the world, calls the classifier,
// rolls, and persists. Every receipt a player can audit is written here,
// and none of it was tested — which is how PlayerAction.rollMade sat
// documented as "Link to DiceRoll.id if rolled" and never written.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const openaiFetch = vi.fn()
vi.mock('@/lib/ai/openaiCompat', () => ({ openaiFetch: (...a: unknown[]) => openaiFetch(...a) }))
vi.mock('@/lib/ai/cost-tracker', () => ({
  recordAICost: vi.fn(async () => {}),
  estimateTokenCount: () => 10,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    character: { findMany: vi.fn(), update: vi.fn(async () => ({})) },
    faction: { findMany: vi.fn(async () => []) },
    nPC: { findMany: vi.fn(async () => []) },
    location: { findMany: vi.fn(async () => []) },
    move: { findMany: vi.fn(async () => []) },
    campaign: { findUnique: vi.fn(async () => ({ corruptionTheme: null })) },
    debt: { findMany: vi.fn(async () => []) },
    diceRoll: { create: vi.fn() },
    playerAction: { update: vi.fn(async () => ({})) },
  },
}))

import { prisma } from '@/lib/prisma'
import { resolveActionMechanics } from '../resolution'

const character = (id: string, name: string) => ({
  id, name,
  stats: { cool: 1, hard: 0, hot: 0, sharp: 0, weird: 0 },
  harm: 0, corruption: 0, pendingBargain: null,
  capabilities: [], factionStandings: [],
  relationships: null, consequences: null, conditions: null,
  perks: [], moves: [],
  currentLocation: null, locationId: null,
  currentZone: null, zoneMetadata: null,
})

/** The classifier's HTTP response, shaped as the real endpoint returns it. */
const classifierReturning = (classifications: unknown[]) => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { content: JSON.stringify({ classifications }) } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }),
})

let rollSeq = 0

beforeEach(() => {
  vi.clearAllMocks()
  rollSeq = 0
  process.env.OPENAI_API_KEY = 'test-key'
  ;(prisma.diceRoll.create as any).mockImplementation(async () => ({ id: `roll-${++rollSeq}` }))
  ;(prisma.character.findMany as any).mockResolvedValue([
    character('char1', 'Jason'),
    character('char2', 'Mira'),
  ])
})

const actions = [
  { id: 'act1', characterId: 'char1', userId: 'u1', actionText: 'Vault the railing' },
  { id: 'act2', characterId: 'char2', userId: 'u2', actionText: 'Cover the door' },
]

describe('resolveActionMechanics — receipts', () => {
  it('writes one DiceRoll per rolled action', async () => {
    openaiFetch.mockResolvedValue(classifierReturning([
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool' },
      { action_index: 1, move_name: 'Act Under Fire', stat_key: 'cool' },
    ]))

    const mechanics = await resolveActionMechanics('camp1', 'scene1', actions, () => 0.5)

    expect(mechanics).toHaveLength(2)
    expect(prisma.diceRoll.create).toHaveBeenCalledTimes(2)
  })

  it('links each action to its OWN roll, not to some other action’s', async () => {
    // The whole point of rollMade, and the reason a per-action link has to
    // be captured rather than inferred after a bulk insert.
    openaiFetch.mockResolvedValue(classifierReturning([
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool' },
      { action_index: 1, move_name: 'Act Under Fire', stat_key: 'cool' },
    ]))

    await resolveActionMechanics('camp1', 'scene1', actions, () => 0.5)

    const updates = (prisma.playerAction.update as any).mock.calls.map((c: any[]) => c[0])
    expect(updates).toHaveLength(2)

    const linked = new Map(updates.map((u: any) => [u.where.id, u.data.rollMade]))
    // Every action got a link...
    for (const id of ['act1', 'act2']) {
      expect(linked.get(id), `${id} has no rollMade`).toBeTruthy()
    }
    // ...and no two actions share one.
    expect(new Set(linked.values()).size).toBe(2)
  })

  it('stamps the move and roll-required flags alongside the link', async () => {
    openaiFetch.mockResolvedValue(classifierReturning([
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool' },
    ]))

    await resolveActionMechanics('camp1', 'scene1', [actions[0]], () => 0.5)

    const data = (prisma.playerAction.update as any).mock.calls[0][0].data
    expect(data).toMatchObject({ moveUsed: 'Act Under Fire', rollRequired: true })
    expect(data.rollMade).toBeTruthy()
    // rollResult is what organic advancement reads to grow stats.
    expect(data.rollResult).toMatchObject({ stat: 'cool', outcome: expect.any(String) })
  })

  it('writes nothing at all when every action is no_roll', async () => {
    openaiFetch.mockResolvedValue(classifierReturning([
      { action_index: 0, move_name: 'no_roll', stat_key: 'cool' },
    ]))

    const mechanics = await resolveActionMechanics('camp1', 'scene1', [actions[0]], () => 0.5)

    expect(mechanics).toEqual([])
    expect(prisma.diceRoll.create).not.toHaveBeenCalled()
    expect(prisma.playerAction.update).not.toHaveBeenCalled()
  })

  it('resolves freeform rather than throwing when the classifier fails', async () => {
    // Fail-open is the documented contract for this whole path: a bad
    // classifier call must cost the mechanics, never the turn.
    openaiFetch.mockRejectedValue(new Error('upstream down'))

    await expect(resolveActionMechanics('camp1', 'scene1', actions, () => 0.5))
      .resolves.toEqual([])
    expect(prisma.diceRoll.create).not.toHaveBeenCalled()
  })

  it('is a no-op for an empty action list, without touching the database', async () => {
    expect(await resolveActionMechanics('camp1', 'scene1', [], () => 0.5)).toEqual([])
    expect(prisma.character.findMany).not.toHaveBeenCalled()
  })

  it('persists each acting character’s range band for the next exchange', async () => {
    // Positions have to carry forward, or the classifier's repositions
    // never persist — the failure that made the original zone system dead.
    openaiFetch.mockResolvedValue(classifierReturning([
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', moves_to_zone: 'close' },
    ]))

    await resolveActionMechanics('camp1', 'scene1', [actions[0]], () => 0.5)

    const zoneWrite = (prisma.character.update as any).mock.calls
      .map((c: any[]) => c[0])
      .find((u: any) => u.data?.currentZone)
    expect(zoneWrite.where.id).toBe('char1')
    expect(zoneWrite.data.currentZone).toBe('close')
    expect(zoneWrite.data.zoneMetadata).toEqual({ sceneId: 'scene1' })
  })
})
