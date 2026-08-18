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

    const { mechanics, classificationUnavailable } = await resolveActionMechanics('camp1', 'scene1', actions, () => 0.5)

    expect(mechanics).toHaveLength(2)
    expect(classificationUnavailable).toBe(false)
    expect(prisma.diceRoll.create).toHaveBeenCalledTimes(2)
  })

  // #221: the debt query had no `take` limit — unbounded row growth on a
  // debt-heavy campaign, even though debtModifier's output stays clamped.
  it('bounds and orders the outstanding-debt query rather than fetching every row', async () => {
    openaiFetch.mockResolvedValue(classifierReturning([
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool' },
      { action_index: 1, move_name: 'Act Under Fire', stat_key: 'cool' },
    ]))

    await resolveActionMechanics('camp1', 'scene1', actions, () => 0.5)

    expect(prisma.debt.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'OUTSTANDING' }),
      orderBy: { createdAt: 'desc' },
      take: 300,
    }))
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

  it('writes nothing at all when every action is no_roll — this is NOT classificationUnavailable', async () => {
    // #200: no_roll is a real, successful classification (nothing was
    // risked), distinct from the classifier failing outright — the two
    // must not collapse into the same signal.
    openaiFetch.mockResolvedValue(classifierReturning([
      { action_index: 0, move_name: 'no_roll', stat_key: 'cool' },
    ]))

    const { mechanics, classificationUnavailable } = await resolveActionMechanics('camp1', 'scene1', [actions[0]], () => 0.5)

    expect(mechanics).toEqual([])
    expect(classificationUnavailable).toBe(false)
    expect(prisma.diceRoll.create).not.toHaveBeenCalled()
    expect(prisma.playerAction.update).not.toHaveBeenCalled()
  })

  it('resolves freeform rather than throwing when the classifier fails, and flags classificationUnavailable (#200)', async () => {
    // Fail-open is the documented contract for this whole path: a bad
    // classifier call must cost the mechanics, never the turn — but it
    // must be VISIBLE that this happened, not indistinguishable from
    // "nothing needed rolling."
    openaiFetch.mockRejectedValue(new Error('upstream down'))

    const result = await resolveActionMechanics('camp1', 'scene1', actions, () => 0.5)

    expect(result.mechanics).toEqual([])
    expect(result.classificationUnavailable).toBe(true)
    // A thrown call IS an API problem — this is the one case where saying so
    // is correct, which is what makes the 'unusable-output' case below wrong
    // to describe the same way.
    expect(result.unavailableReason).toBe('api-error')
    expect(prisma.diceRoll.create).not.toHaveBeenCalled()
  })

  it("reports the MODEL's bad output as unusable-output, not as an API problem", async () => {
    // The 2026-08-18 incident: the classifier call succeeded and was billed,
    // and returned stat_key: null. The banner blamed "an API issue" and sent
    // the reader to OpenAI's status page. The cause has to survive the trip
    // to the UI or the message cannot be right.
    openaiFetch.mockResolvedValue(classifierReturning([
      { action_index: 0, move_name: 'Act Under Fire', stat_key: null },
    ]))

    const result = await resolveActionMechanics('camp1', 'scene1', [actions[0]], () => 0.5)

    expect(result.classificationUnavailable).toBe(true)
    expect(result.unavailableReason).toBe('unusable-output')
    expect(result.droppedFields).toContain('stat_key')
    expect(prisma.diceRoll.create).not.toHaveBeenCalled()
  })

  it('flags classificationUnavailable specifically when OPENAI_API_KEY is missing (#200)', async () => {
    delete process.env.OPENAI_API_KEY

    const result = await resolveActionMechanics('camp1', 'scene1', actions, () => 0.5)

    expect(result.mechanics).toEqual([])
    expect(result.classificationUnavailable).toBe(true)
    expect(result.unavailableReason).toBe('no-api-key')
    expect(openaiFetch).not.toHaveBeenCalled()
    expect(prisma.diceRoll.create).not.toHaveBeenCalled()
  })

  it('is a no-op for an empty action list, without touching the database, and is NOT classificationUnavailable', async () => {
    expect(await resolveActionMechanics('camp1', 'scene1', [], () => 0.5))
      .toEqual({ mechanics: [], classificationUnavailable: false })
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
