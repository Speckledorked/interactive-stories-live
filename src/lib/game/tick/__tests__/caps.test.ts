import { describe, it, expect } from 'vitest'
import { resolveTickCaps, DEFAULT_FACTION_CAP, DEFAULT_NPC_CAP, MAX_FACTION_CAP, MAX_NPC_CAP } from '../caps'

// #203: the max caps exist so the admin-settable settings route (see
// settings/simulation/route.ts) has something principled to enforce — the
// real gate is tested there, this just pins the relationship to the
// defaults so it can't silently drift to something smaller than a default
// (which would make the "default" itself unreachable) or absurdly large.
describe('MAX_FACTION_CAP / MAX_NPC_CAP', () => {
  it('are a real multiple of, and strictly above, their defaults', () => {
    expect(MAX_FACTION_CAP).toBeGreaterThan(DEFAULT_FACTION_CAP)
    expect(MAX_NPC_CAP).toBeGreaterThan(DEFAULT_NPC_CAP)
    expect(MAX_FACTION_CAP % DEFAULT_FACTION_CAP).toBe(0)
    expect(MAX_NPC_CAP % DEFAULT_NPC_CAP).toBe(0)
  })
})

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
