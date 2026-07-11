import { describe, it, expect } from 'vitest'
import { resolveTickCaps, DEFAULT_FACTION_CAP, DEFAULT_NPC_CAP } from '../caps'

describe('resolveTickCaps', () => {
  it('falls back to defaults when worldMeta is null', () => {
    expect(resolveTickCaps(null)).toEqual({ factionCap: DEFAULT_FACTION_CAP, npcCap: DEFAULT_NPC_CAP })
  })

  it('falls back to defaults when both fields are explicitly null', () => {
    expect(resolveTickCaps({ factionCap: null, npcCap: null })).toEqual({
      factionCap: DEFAULT_FACTION_CAP,
      npcCap: DEFAULT_NPC_CAP,
    })
  })

  it('honors an override for factionCap while npcCap still falls back', () => {
    expect(resolveTickCaps({ factionCap: 25, npcCap: null })).toEqual({ factionCap: 25, npcCap: DEFAULT_NPC_CAP })
  })

  it('honors an override for npcCap while factionCap still falls back', () => {
    expect(resolveTickCaps({ factionCap: null, npcCap: 40 })).toEqual({ factionCap: DEFAULT_FACTION_CAP, npcCap: 40 })
  })

  it('honors both overrides simultaneously', () => {
    expect(resolveTickCaps({ factionCap: 5, npcCap: 5 })).toEqual({ factionCap: 5, npcCap: 5 })
  })
})
