// src/lib/game/__tests__/harm.test.ts
// applyHarm/healHarm are the two harm.ts functions the item-scope
// follow-up now shares between PCs and NPCs (see stateUpdater.ts's
// npc_changes.harm_damage handling and inventory_changes' consumable
// 'heal' effect) — worth a baseline unit test now that a second caller
// depends on their exact threshold behavior.

import { describe, it, expect } from 'vitest'
import { applyHarm, healHarm } from '../harm'

describe('applyHarm', () => {
  it('adds damage minus armor reduction, floored at 0', () => {
    const result = applyHarm(0, 3, 1)
    expect(result.newHarm).toBe(2)
  })

  it('never lets armor reduction produce negative actual damage', () => {
    const result = applyHarm(0, 1, 5)
    expect(result.newHarm).toBe(0)
  })

  it('caps new harm at 6 regardless of overkill damage', () => {
    const result = applyHarm(5, 10, 0)
    expect(result.newHarm).toBe(6)
  })

  it('crossing into 4+ reports becoming Impaired', () => {
    const result = applyHarm(3, 1, 0)
    expect(result.newHarm).toBe(4)
    expect(result.message).toContain('Impaired')
  })

  it('reaching exactly 6 reports Taken Out and an auto condition', () => {
    const result = applyHarm(4, 2, 0)
    expect(result.newHarm).toBe(6)
    expect(result.message).toContain('Taken Out')
    expect(result.autoConditions).toHaveLength(1)
    expect(result.autoConditions[0].name).toBe('Taken Out')
  })

  it('produces no auto conditions below 6', () => {
    const result = applyHarm(0, 3, 0)
    expect(result.autoConditions).toHaveLength(0)
  })
})

describe('healHarm', () => {
  it('subtracts healing, floored at 0', () => {
    expect(healHarm(2, 5).newHarm).toBe(0)
  })

  it('reports leaving Taken Out when healing drops below 6', () => {
    const result = healHarm(6, 1)
    expect(result.newHarm).toBe(5)
    expect(result.message).toContain('no longer Taken Out')
  })

  it('reports leaving Impaired when healing drops to 3 or below', () => {
    const result = healHarm(4, 1)
    expect(result.newHarm).toBe(3)
    expect(result.message).toContain('no longer Impaired')
  })

  it('does not report a threshold crossing that did not happen', () => {
    const result = healHarm(6, 0)
    expect(result.newHarm).toBe(6)
    expect(result.message).not.toContain('no longer')
  })
})
