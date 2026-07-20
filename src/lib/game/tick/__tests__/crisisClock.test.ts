import { describe, it, expect } from 'vitest';
import { pickMostThreateningFaction, decideCrisisEscalation } from '../crisisClock';

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
