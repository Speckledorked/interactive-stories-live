import { describe, it, expect } from 'vitest'
import { noDuplicateNpcNames, noDuplicateFactionNames, noDuplicateQuestNames } from '../checks/duplicateNames'
import { INTEGRITY_REPAIRS } from '../checkRegistry'
import { emptySnapshot } from './testHelpers'

describe('noDuplicateNpcNames', () => {
  it('flags every row sharing a name, case/whitespace-insensitively', () => {
    const snapshot = emptySnapshot({
      npcs: [
        { id: 'npc1', name: 'Lord Kessler', isAlive: true, factionId: null, factionRole: null, importance: 1, socialTies: null },
        { id: 'npc2', name: '  lord   kessler ', isAlive: true, factionId: null, factionRole: null, importance: 1, socialTies: null },
        { id: 'npc3', name: 'Vashti', isAlive: true, factionId: null, factionRole: null, importance: 1, socialTies: null },
      ],
    })
    const violations = noDuplicateNpcNames.run(snapshot)
    expect(violations).toHaveLength(2)
    expect(violations.map((v) => v.entityId).sort()).toEqual(['npc1', 'npc2'])
  })

  it('does not flag unique names', () => {
    const snapshot = emptySnapshot({
      npcs: [
        { id: 'npc1', name: 'Kessler', isAlive: true, factionId: null, factionRole: null, importance: 1, socialTies: null },
        { id: 'npc2', name: 'Vashti', isAlive: true, factionId: null, factionRole: null, importance: 1, socialTies: null },
      ],
    })
    expect(noDuplicateNpcNames.run(snapshot)).toHaveLength(0)
  })
})

describe('noDuplicateFactionNames / noDuplicateQuestNames', () => {
  it('apply the same rule to factions and quests', () => {
    const factionSnapshot = emptySnapshot({
      factions: [
        { id: 'f1', name: 'The Crown', isActive: true, leaderCharacterId: null, relationships: {} },
        { id: 'f2', name: 'The Crown', isActive: true, leaderCharacterId: null, relationships: {} },
      ],
    })
    expect(noDuplicateFactionNames.run(factionSnapshot)).toHaveLength(2)

    const questSnapshot = emptySnapshot({
      quests: [{ id: 'q1', name: 'Find the Ledger' }, { id: 'q2', name: 'Find the Ledger' }],
    })
    expect(noDuplicateQuestNames.run(questSnapshot)).toHaveLength(2)
  })
})

describe('duplicate-name checks are detect-only', () => {
  it('have no entry in the repair registry — deciding which duplicate is real is a judgment call', () => {
    expect(INTEGRITY_REPAIRS['npc.name.unique']).toBeUndefined()
    expect(INTEGRITY_REPAIRS['faction.name.unique']).toBeUndefined()
    expect(INTEGRITY_REPAIRS['quest.name.unique']).toBeUndefined()
  })
})
