import { describe, it, expect } from 'vitest';
import { pickMostThreateningFaction, pickCrisisFaction, decideCrisisEscalation } from '../crisisClock';

describe('pickMostThreateningFaction', () => {
  it('returns null for an empty list', () => {
    expect(pickMostThreateningFaction([])).toBeNull();
  });

  it('picks the faction with the highest threatLevel', () => {
    const result = pickMostThreateningFaction([
      { id: 'a', name: 'Weak', threatLevel: 2, military: 50, resources: 50 },
      { id: 'b', name: 'Dangerous', threatLevel: 5, military: 40, resources: 40 },
      { id: 'c', name: 'Middling', threatLevel: 3, military: 60, resources: 60 },
    ]);
    expect(result?.name).toBe('Dangerous');
  });

  it('breaks a threatLevel tie by military + resources', () => {
    const result = pickMostThreateningFaction([
      { id: 'a', name: 'Lean', threatLevel: 4, military: 30, resources: 30 },
      { id: 'b', name: 'Stacked', threatLevel: 4, military: 80, resources: 80 },
    ]);
    expect(result?.name).toBe('Stacked');
  });

  it('breaks a full tie deterministically by id', () => {
    const result = pickMostThreateningFaction([
      { id: 'z-faction', name: 'Z', threatLevel: 3, military: 50, resources: 50 },
      { id: 'a-faction', name: 'A', threatLevel: 3, military: 50, resources: 50 },
    ]);
    expect(result?.id).toBe('a-faction');
  });
});

describe('decideCrisisEscalation', () => {
  it('spawns a new clock when the faction has no active clock', () => {
    const decision = decideCrisisEscalation(null);
    expect(decision.action).toBe('spawn');
  });

  it('escalates an existing clock by half its remaining ticks, rounded up', () => {
    const decision = decideCrisisEscalation({ currentTicks: 2, maxTicks: 10 });
    expect(decision).toEqual({ action: 'escalate', newTicks: 6 }); // remaining 8, jump 4
  });

  it('never overshoots maxTicks', () => {
    const decision = decideCrisisEscalation({ currentTicks: 9, maxTicks: 10 });
    expect(decision).toEqual({ action: 'escalate', newTicks: 10 }); // remaining 1, jump max(1, 1)=1
  });

  it('always jumps at least one tick even when nearly complete', () => {
    const decision = decideCrisisEscalation({ currentTicks: 0, maxTicks: 1 });
    expect(decision).toEqual({ action: 'escalate', newTicks: 1 });
  });
});

// ---------------------------------------------------------------------------
// History-aware crisis targeting (#79)
// ---------------------------------------------------------------------------
// The deterministic simulation decides everything else from a snapshot of
// right-now, which means it can't notice when it repeats itself. The
// strongest faction stays the strongest, so pure threat ranking hands every
// milestone crisis to the same faction forever.

describe('pickCrisisFaction (#79)', () => {
  const f = (id: string, threatLevel: number, military = 50, resources = 50) =>
    ({ id, name: `Faction ${id}`, threatLevel, military, resources })

  it('behaves exactly like pure threat ranking when there is no history', () => {
    const factions = [f('a', 2), f('b', 4), f('c', 3)]
    expect(pickCrisisFaction(factions, [])?.id).toBe('b')
    expect(pickCrisisFaction(factions, [])?.id).toBe(pickMostThreateningFaction(factions)?.id)
  })

  it('passes over the faction that had the last crisis', () => {
    const factions = [f('a', 2), f('b', 4), f('c', 3)]
    // 'b' is strongest but just had its turn — the next-most-threatening
    // unused faction gets it instead.
    expect(pickCrisisFaction(factions, ['b'])?.id).toBe('c')
  })

  it('rotates through the field across successive crises', () => {
    const factions = [f('a', 2), f('b', 4), f('c', 3)]
    expect(pickCrisisFaction(factions, ['b'])?.id).toBe('c')
    expect(pickCrisisFaction(factions, ['c', 'b'])?.id).toBe('a')
  })

  it('falls back to the strongest once every faction is recent', () => {
    // Demotion, not a ban: escalating the usual suspect beats a milestone
    // that quietly does nothing.
    const factions = [f('a', 2), f('b', 4)]
    expect(pickCrisisFaction(factions, ['a', 'b'])?.id).toBe('b')
  })

  it('still returns null when there are no factions at all', () => {
    expect(pickCrisisFaction([], ['a'])).toBeNull()
  })

  it('ignores history entries for factions that no longer exist', () => {
    const factions = [f('a', 2), f('b', 4)]
    // A collapsed faction's id lingering in history must not suppress
    // anyone still standing.
    expect(pickCrisisFaction(factions, ['long-gone'])?.id).toBe('b')
  })

  it('keeps the deterministic tie-break among unused factions', () => {
    const factions = [f('a', 3, 90, 90), f('b', 3, 10, 10), f('c', 5)]
    expect(pickCrisisFaction(factions, ['c'])?.id).toBe('a')
  })
})
