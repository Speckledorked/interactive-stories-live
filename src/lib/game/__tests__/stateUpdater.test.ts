// src/lib/game/__tests__/stateUpdater.test.ts
//
// Direct coverage for applyWorldUpdates — the function that turns every
// AI-authored world_updates field into durable state (#68).
//
// This had no dedicated tests, and the one test file that imported it
// (sceneResolver.test.ts) mocks it away wholesale, so its real logic was
// exercised nowhere in the suite despite being the single most
// consequential correctness path in the codebase.
//
// The per-domain appliers under worldUpdaters/ are already well covered
// individually, so they're mocked here on purpose: what's under test is
// the ORCHESTRATOR's own behavior, which nothing else checks —
// conditional roster fetching, delegation and its ordering, sceneOrigin
// threading (the fog-of-war gate), the corruption-theme memoization
// shared across two appliers, result propagation, and error wrapping.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  },
}))

vi.mock('../worldUpdaters/timelineEvents', () => ({ applyTimelineEventChanges: vi.fn(async () => {}) }))
vi.mock('../worldUpdaters/clocks', () => ({ applyClockChanges: vi.fn(async () => ({ worldChanges: [] })) }))
vi.mock('../worldUpdaters/npcs', () => ({
  applyNpcChanges: vi.fn(async () => ({ involvedNpcIds: ['npc-from-applier'], worldChanges: [] })),
}))
// Returns the corruption-gate refusals (#83) and any character_name_or_id
// that never matched a real character; empty arrays are the normal case.
vi.mock('../worldUpdaters/characters', () => ({ applyCharacterChanges: vi.fn(async () => ({ gateRefusals: [] as string[], unresolvedCharacterNames: [] as string[], worldChanges: [] })) }))
vi.mock('../worldUpdaters/factions', () => ({
  applyFactionChanges: vi.fn(async () => ({ involvedFactionIds: ['faction-from-applier'], worldChanges: [] })),
}))
vi.mock('../worldUpdaters/locations', () => ({ applyLocationChanges: vi.fn(async () => ({ worldChanges: [] })) }))
vi.mock('../worldUpdaters/quests', () => ({ applyQuestChanges: vi.fn(async () => ({ worldChanges: [] })) }))
vi.mock('../worldUpdaters/bargainOffers', () => ({ applyBargainOffers: vi.fn(async () => {}) }))
vi.mock('../worldUpdaters/worldMetaNotes', () => ({ storeGmNotesForTurn: vi.fn(async () => {}) }))
vi.mock('../tick/worldEventLog', () => ({ persistWorldEvents: vi.fn(async () => 0) }))

import { applyWorldUpdates } from '../stateUpdater'
import { applyTimelineEventChanges } from '../worldUpdaters/timelineEvents'
import { applyClockChanges } from '../worldUpdaters/clocks'
import { applyNpcChanges } from '../worldUpdaters/npcs'
import { applyCharacterChanges } from '../worldUpdaters/characters'
import { applyFactionChanges } from '../worldUpdaters/factions'
import { applyLocationChanges } from '../worldUpdaters/locations'
import { applyQuestChanges } from '../worldUpdaters/quests'
import { applyBargainOffers } from '../worldUpdaters/bargainOffers'
import { storeGmNotesForTurn } from '../worldUpdaters/worldMetaNotes'

const makeTx = () => ({
  campaign: { findUnique: vi.fn(async () => ({ corruptionTheme: { name: 'The Hunger' } })) },
  clock: { findMany: vi.fn(async () => [{ id: 'c1' }]) },
  nPC: { findMany: vi.fn(async () => [{ id: 'n1' }]) },
  character: { findMany: vi.fn(async () => [{ id: 'ch1' }]) },
  faction: { findMany: vi.fn(async () => [{ id: 'f1' }]) },
})

let tx: ReturnType<typeof makeTx>

beforeEach(() => {
  vi.clearAllMocks()
  tx = makeTx()
})

/** A response carrying only the world_updates fields a given test needs. */
const response = (worldUpdates: Record<string, unknown>) =>
  ({ scene_text: 'something happened', world_updates: worldUpdates } as any)

describe('applyWorldUpdates — delegation', () => {
  it('calls no applier when world_updates is empty', async () => {
    await applyWorldUpdates('camp1', response({}), 5)
    expect(applyTimelineEventChanges).not.toHaveBeenCalled()
    expect(applyClockChanges).not.toHaveBeenCalled()
    expect(applyNpcChanges).not.toHaveBeenCalled()
    expect(applyCharacterChanges).not.toHaveBeenCalled()
    expect(applyFactionChanges).not.toHaveBeenCalled()
    expect(applyLocationChanges).not.toHaveBeenCalled()
    expect(applyQuestChanges).not.toHaveBeenCalled()
    expect(applyBargainOffers).not.toHaveBeenCalled()
    expect(storeGmNotesForTurn).not.toHaveBeenCalled()
  })

  it('routes each field to its own applier and nothing else', async () => {
    await applyWorldUpdates('camp1', response({ quest_changes: [{ name: 'Find the ledger' }] }), 7)
    expect(applyQuestChanges).toHaveBeenCalledWith(
      tx, 'camp1', 7, [{ name: 'Find the ledger' }]
    )
    expect(applyNpcChanges).not.toHaveBeenCalled()
    expect(applyCharacterChanges).not.toHaveBeenCalled()
  })

  it('passes the turn number through to the appliers that take one', async () => {
    await applyWorldUpdates(
      'camp1',
      response({ new_timeline_events: [{ title: 'X' }], pc_changes: [{ character_name_or_id: 'Vera', changes: {} }] }),
      42
    )
    expect(applyTimelineEventChanges).toHaveBeenCalledWith(tx, 'camp1', 42, [{ title: 'X' }], undefined)
    expect(applyCharacterChanges).toHaveBeenCalledWith(
      tx, 'camp1', 42, expect.anything(), expect.anything(), expect.anything(), expect.any(Function), true, []
    )
  })
})

describe('applyWorldUpdates — conditional roster fetching', () => {
  it('fetches no rosters when nothing needs resolving', async () => {
    await applyWorldUpdates('camp1', response({ new_timeline_events: [{ title: 'X' }] }), 1)
    expect(tx.clock.findMany).not.toHaveBeenCalled()
    expect(tx.nPC.findMany).not.toHaveBeenCalled()
    expect(tx.character.findMany).not.toHaveBeenCalled()
    expect(tx.faction.findMany).not.toHaveBeenCalled()
  })

  it('fetches only the rosters the present change types actually need', async () => {
    await applyWorldUpdates('camp1', response({ clock_changes: [{ clock_name_or_id: 'Doom', delta: 1 }] }), 1)
    expect(tx.clock.findMany).toHaveBeenCalledOnce()
    expect(tx.nPC.findMany).not.toHaveBeenCalled()
    expect(tx.faction.findMany).not.toHaveBeenCalled()
    // The character roster is shared by npc_changes and pc_changes; neither
    // is present here, so it must not be fetched either.
    expect(tx.character.findMany).not.toHaveBeenCalled()
  })

  it('fetches the character roster for npc_changes alone, since NPC harm needs the attacker', async () => {
    await applyWorldUpdates('camp1', response({ npc_changes: [{ npc_name_or_id: 'Duke', changes: {} }] }), 1)
    expect(tx.nPC.findMany).toHaveBeenCalledOnce()
    expect(tx.character.findMany).toHaveBeenCalledOnce()
  })

  it('fetches the character roster exactly once when both npc_changes and pc_changes are present', async () => {
    await applyWorldUpdates(
      'camp1',
      response({
        npc_changes: [{ npc_name_or_id: 'Duke', changes: {} }],
        pc_changes: [{ character_name_or_id: 'Vera', changes: {} }],
      }),
      1
    )
    expect(tx.character.findMany).toHaveBeenCalledOnce()
  })
})

describe('applyWorldUpdates — sceneOrigin (fog of war) threading', () => {
  it('defaults to true — a live scene reveals what it touches', async () => {
    await applyWorldUpdates('camp1', response({ npc_changes: [{ npc_name_or_id: 'Duke', changes: {} }] }), 1)
    expect(applyNpcChanges).toHaveBeenCalledWith(
      tx, 'camp1', expect.anything(), expect.anything(), expect.anything(), true
    )
  })

  it('passes false through to every applier that gates discovery on it', async () => {
    await applyWorldUpdates(
      'camp1',
      response({
        npc_changes: [{ npc_name_or_id: 'Duke', changes: {} }],
        faction_changes: [{ faction_name_or_id: 'Crown', changes: {} }],
        location_changes: [{ name: 'Ruins' }],
        pc_changes: [{ character_name_or_id: 'Vera', changes: {} }],
      }),
      1,
      false
    )
    expect(applyNpcChanges).toHaveBeenCalledWith(tx, 'camp1', expect.anything(), expect.anything(), expect.anything(), false)
    expect(applyFactionChanges).toHaveBeenCalledWith(tx, 'camp1', expect.anything(), expect.anything(), false)
    expect(applyLocationChanges).toHaveBeenCalledWith(tx, 'camp1', expect.anything(), false)
    expect(applyCharacterChanges).toHaveBeenCalledWith(
      tx, 'camp1', 1, expect.anything(), expect.anything(), expect.anything(), expect.any(Function), false, []
    )
  })

  it('skips bargain offers entirely on an offscreen update', async () => {
    // An offscreen tick can't put a devil's bargain in front of a player.
    await applyWorldUpdates(
      'camp1',
      response({ bargain_offers: [{ character_name_or_id: 'Vera', offer: 'Power, for a price' }] }),
      1,
      false
    )
    expect(applyBargainOffers).not.toHaveBeenCalled()
  })

  it('applies bargain offers on a live scene', async () => {
    await applyWorldUpdates(
      'camp1',
      response({ bargain_offers: [{ character_name_or_id: 'Vera', offer: 'Power, for a price' }] }),
      1,
      true
    )
    expect(applyBargainOffers).toHaveBeenCalledOnce()
  })

  it('skips bargain offers when the array is present but empty', async () => {
    await applyWorldUpdates('camp1', response({ bargain_offers: [] }), 1, true)
    expect(applyBargainOffers).not.toHaveBeenCalled()
  })
})

describe('applyWorldUpdates — corruption theme memoization', () => {
  it('does not look the theme up at all when nothing needs it', async () => {
    await applyWorldUpdates('camp1', response({ quest_changes: [{ name: 'Q' }] }), 1)
    expect(tx.campaign.findUnique).not.toHaveBeenCalled()
  })

  it('looks the theme up at most once even when two appliers both request it', async () => {
    ;(applyCharacterChanges as any).mockImplementation(async (...args: any[]) => {
      await args[6]() // getCorruptionTheme
      await args[6]()
      return { gateRefusals: [], unresolvedCharacterNames: [], worldChanges: [] }
    })
    ;(applyBargainOffers as any).mockImplementation(async (...args: any[]) => {
      await args[4]() // getCorruptionTheme
    })

    await applyWorldUpdates(
      'camp1',
      response({
        pc_changes: [{ character_name_or_id: 'Vera', changes: {} }],
        bargain_offers: [{ character_name_or_id: 'Vera', offer: 'A bargain' }],
      }),
      1,
      true
    )

    expect(tx.campaign.findUnique).toHaveBeenCalledOnce()
  })

  it('caches a null theme too, rather than re-querying every time', async () => {
    tx.campaign.findUnique = vi.fn(async () => ({ corruptionTheme: null })) as any
    ;(applyCharacterChanges as any).mockImplementation(async (...args: any[]) => {
      await args[6]()
      await args[6]()
      await args[6]()
      return { gateRefusals: [], unresolvedCharacterNames: [], worldChanges: [] }
    })

    await applyWorldUpdates('camp1', response({ pc_changes: [{ character_name_or_id: 'Vera', changes: {} }] }), 1)
    expect(tx.campaign.findUnique).toHaveBeenCalledOnce()
  })
})

describe('applyWorldUpdates — results and failure', () => {
  it('propagates involved ids from the appliers that produce them', async () => {
    const result = await applyWorldUpdates(
      'camp1',
      response({
        npc_changes: [{ npc_name_or_id: 'Duke', changes: {} }],
        faction_changes: [{ faction_name_or_id: 'Crown', changes: {} }],
      }),
      1
    )
    expect(result).toEqual({
      involvedNpcIds: ['npc-from-applier'],
      involvedFactionIds: ['faction-from-applier'],
      unresolvedCharacterNames: [],
      worldChanges: [],
    })
  })

  it('returns empty id lists when the relevant appliers never ran', async () => {
    const result = await applyWorldUpdates('camp1', response({ quest_changes: [{ name: 'Q' }] }), 1)
    expect(result).toEqual({ involvedNpcIds: [], involvedFactionIds: [], unresolvedCharacterNames: [], worldChanges: [] })
  })

  it('wraps and rethrows when an applier fails, so the caller sees a real failure', async () => {
    ;(applyQuestChanges as any).mockRejectedValueOnce(new Error('quest writer exploded'))
    await expect(
      applyWorldUpdates('camp1', response({ quest_changes: [{ name: 'Q' }] }), 1)
    ).rejects.toThrow(/Failed to apply world updates/)
  })

  it('never silently swallows an applier failure into a success result', async () => {
    ;(applyCharacterChanges as any).mockRejectedValueOnce(new Error('boom'))
    await expect(
      applyWorldUpdates('camp1', response({ pc_changes: [{ character_name_or_id: 'Vera', changes: {} }] }), 1)
    ).rejects.toThrow()
  })
})

describe('applyWorldUpdates — organic_advancement is deliberately NOT applied here', () => {
  it('ignores organic_advancement entirely', async () => {
    // sceneResolver.ts's applyOrganicCharacterGrowth is the single writer
    // for this field. Processing it here too would double-apply every stat
    // increase, perk, and ability the AI reports, since both run in the
    // same resolution. Nothing here should touch it — including via
    // applyCharacterChanges, which receives only pc_changes.
    await applyWorldUpdates(
      'camp1',
      response({ organic_advancement: [{ character_id: 'ch1', new_perks: [{ name: 'Free Perk', description: 'x' }] }] }),
      1
    )
    expect(applyCharacterChanges).not.toHaveBeenCalled()
    expect(tx.character.findMany).not.toHaveBeenCalled()
  })
})
