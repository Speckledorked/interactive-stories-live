// src/lib/game/__tests__/entityConnections.test.ts
// #521: these are EDGES, so the property that matters is what happens at
// the FAR end — the endpoint the card's own fog filter never looked at.

import { describe, it, expect } from 'vitest'
import {
  describeDebtWeight,
  npcConnectionsFor,
  factionConnectionsFor,
  locationConnectionsFor,
} from '../entityConnections'

describe('describeDebtWeight', () => {
  it('returns a word, never a figure, across the range', () => {
    // Same rule noRawSimulationNumbers pins for threat and stability: a
    // player reads the band, not the integer behind it.
    for (const amount of [0, 1, 10, 11, 30, 31, 100, 1000]) {
      const label = describeDebtWeight(amount)
      expect(label, `amount ${amount} produced no label`).toBeTruthy()
      expect(label, `amount ${amount} leaked a digit: "${label}"`).not.toMatch(/\d/)
    }
  })

  it('separates a debt that clears soon from one that does not', () => {
    expect(describeDebtWeight(10)).not.toEqual(describeDebtWeight(100))
  })
})

describe('npcConnectionsFor', () => {
  const known = new Map([
    ['npc-mira', 'Mira'],
    ['npc-dav', 'Dav'],
  ])

  it('splits allies from rivals and sorts them', () => {
    const result = npcConnectionsFor(
      [
        { otherId: 'npc-mira', type: 'RIVAL' },
        { otherId: 'npc-dav', type: 'ALLY' },
      ],
      known
    )
    expect(result.allies).toEqual(['Dav'])
    expect(result.rivals).toEqual(['Mira'])
  })

  it('drops a tie to an NPC the party has not discovered', () => {
    // Not anonymised: "an ally you have not met" still reveals that the
    // undiscovered NPC exists, which is the thing the fog is for.
    const result = npcConnectionsFor([{ otherId: 'npc-stranger', type: 'ALLY' }], known)
    expect(result.allies).toEqual([])
    expect(result.rivals).toEqual([])
  })
})

describe('factionConnectionsFor', () => {
  const visible = new Map([
    ['f-iron', 'The Iron Company'],
    ['f-thorn', 'The Circle of Thorns'],
  ])

  const debt = { creditorFactionId: 'f-thorn', debtorFactionId: 'f-iron', amount: 40 }

  it("reads a debt from the debtor's side as something owed", () => {
    const result = factionConnectionsFor('PLAYER', 'f-iron', [debt], visible)
    expect(result.owes).toHaveLength(1)
    expect(result.owes[0].faction).toBe('The Circle of Thorns')
    expect(result.owed).toEqual([])
  })

  it("reads the same row from the creditor's side as something owed to them", () => {
    const result = factionConnectionsFor('PLAYER', 'f-thorn', [debt], visible)
    expect(result.owed).toHaveLength(1)
    expect(result.owed[0].faction).toBe('The Iron Company')
    expect(result.owes).toEqual([])
  })

  it('withholds the amount from a player and gives it to an admin', () => {
    expect(factionConnectionsFor('PLAYER', 'f-iron', [debt], visible).owes[0].amount).toBeNull()
    expect(factionConnectionsFor('ADMIN', 'f-iron', [debt], visible).owes[0].amount).toBe(40)
    // The band reaches both roles — it is the only form the card renders.
    expect(factionConnectionsFor('PLAYER', 'f-iron', [debt], visible).owes[0].weight).toBeTruthy()
  })

  it('drops a debt whose counterparty is undiscovered', () => {
    const hidden = { creditorFactionId: 'f-hidden', debtorFactionId: 'f-iron', amount: 40 }
    const result = factionConnectionsFor('PLAYER', 'f-iron', [hidden], visible)
    expect(result.owes).toEqual([])
    expect(result.owed).toEqual([])
  })
})

describe('locationConnectionsFor', () => {
  const visible = new Map([
    ['loc-keep', 'Thornkeep'],
    ['loc-mill', 'Sutter Mill'],
    ['loc-ford', 'Greyford'],
  ])

  const route = (from: string, to: string, isBlockaded = false) => ({
    fromLocationId: from,
    toLocationId: to,
    isBlockaded,
  })

  it('names the other end of a route regardless of direction', () => {
    const result = locationConnectionsFor(
      'loc-keep',
      [route('loc-keep', 'loc-mill'), route('loc-ford', 'loc-keep')],
      [],
      visible
    )
    expect(result.routes.map((r) => r.to)).toEqual(['Greyford', 'Sutter Mill'])
  })

  it('calls a place cut off only when every known route is blockaded', () => {
    const allBlocked = locationConnectionsFor(
      'loc-keep',
      [route('loc-keep', 'loc-mill', true), route('loc-ford', 'loc-keep', true)],
      [],
      visible
    )
    expect(allBlocked.cutOff).toBe(true)

    const oneOpen = locationConnectionsFor(
      'loc-keep',
      [route('loc-keep', 'loc-mill', true), route('loc-ford', 'loc-keep', false)],
      [],
      visible
    )
    expect(oneOpen.cutOff).toBe(false)
  })

  it('does not call a place with no routes at all cut off', () => {
    // No routes means nothing is known about its logistics, which is not
    // the same claim as "it is starving".
    expect(locationConnectionsFor('loc-keep', [], [], visible).cutOff).toBe(false)
  })

  it('resolves flight destinations through the fog rather than trusting the stored name', () => {
    // The row denormalizes toLocationName at write time, when the place
    // may have been visible. Reading it directly would be a way around
    // the filter.
    const result = locationConnectionsFor(
      'loc-keep',
      [],
      [
        { toLocationId: 'loc-mill', toLocationName: 'Sutter Mill' },
        { toLocationId: 'loc-secret', toLocationName: 'The Hidden Vault' },
      ],
      visible
    )
    expect(result.fleeingTo).toEqual(['Sutter Mill'])
  })

  it('does not repeat a destination people keep fleeing to', () => {
    const result = locationConnectionsFor(
      'loc-keep',
      [],
      [
        { toLocationId: 'loc-mill', toLocationName: 'Sutter Mill' },
        { toLocationId: 'loc-mill', toLocationName: 'Sutter Mill' },
      ],
      visible
    )
    expect(result.fleeingTo).toEqual(['Sutter Mill'])
  })
})
