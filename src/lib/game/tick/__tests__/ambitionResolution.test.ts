// src/lib/game/tick/__tests__/ambitionResolution.test.ts
// #227: belief drift (tickBeliefDrift -> tickFactions, both earlier in the
// same runWorldTick pass) can flip Faction.goal in the exact same tick an
// ambition clock completes. resolveCompletedAmbitions used to read
// faction.goal fresh — after that drift already committed — to decide the
// outcome's flavor/stat branch AND whether/how the agenda continues, so a
// clock spawned as EXPAND could resolve and continue as if it had always
// been the faction's new, drifted goal. These tests assert resolution uses
// the goal snapshotted on the clock itself (Clock.goal) instead.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  factionFindUnique: vi.fn(),
  factionUpdate: vi.fn(),
  locationFindFirst: vi.fn(),
  locationUpdate: vi.fn(),
  clockCount: vi.fn(),
  clockCreate: vi.fn(),
  timelineEventCreate: vi.fn(),
  persistWorldEvents: vi.fn(),
  logSignificantChanges: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    faction: { findUnique: mocks.factionFindUnique, update: mocks.factionUpdate },
    location: { findFirst: mocks.locationFindFirst, update: mocks.locationUpdate },
    clock: { count: mocks.clockCount, create: mocks.clockCreate },
    timelineEvent: { create: mocks.timelineEventCreate },
  },
}))
vi.mock('../worldEventLog', () => ({ persistWorldEvents: mocks.persistWorldEvents }))
vi.mock('../historyLog', () => ({ logSignificantChanges: mocks.logSignificantChanges }))

import { resolveCompletedAmbitions } from '../ambitionResolution'
import { simTurn } from '@/lib/game/turnClock'

describe('resolveCompletedAmbitions (#227)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.factionUpdate.mockResolvedValue({})
    mocks.locationFindFirst.mockResolvedValue(null)
    mocks.locationUpdate.mockResolvedValue({})
    mocks.clockCount.mockResolvedValue(1)
    mocks.clockCreate.mockResolvedValue({ id: 'new-clock' })
    mocks.timelineEventCreate.mockResolvedValue({})
    mocks.persistWorldEvents.mockResolvedValue(undefined)
    mocks.logSignificantChanges.mockResolvedValue(undefined)
  })

  // Faction id/clock id/military chosen so decideAmbitionOutcome's
  // deterministic roll (stableHash('faction-drift-1:clock-drift-1') % 100
  // === 60) lands under DESTABILIZE_RIVAL's success chance at military=100
  // (clamp(40 + 100*0.5, 40, 90) = 90) — a real, reproducible success, not
  // a mocked outcome.
  const faction = {
    id: 'faction-drift-1',
    name: 'The Ashen Compact',
    // Drifted to ENRICH THIS tick by tickBeliefDrift/tickFactions, earlier
    // in the same runWorldTick pass — no longer DESTABILIZE_RIVAL, the
    // goal this clock was actually spawned to pursue.
    goal: 'ENRICH',
    archetype: 'GENERIC',
    resources: 70,
    military: 100,
    stability: 50,
    threatLevel: 2,
    isActive: true,
    relationships: {},
    // High aggression, low mercantilism — supports continuing a
    // DESTABILIZE_RIVAL/EXPAND agenda, not an ENRICH one.
    beliefVector: { aggression: 80, isolationism: 20, mercantilism: 10, zealotry: 10 },
  }

  const clock = {
    id: 'clock-drift-1',
    name: 'The Ashen Compact Shadow War',
    sourceFactionId: 'faction-drift-1',
    targetFactionId: null,
    agendaId: null,
    isHidden: false,
    // Snapshotted at spawn time — the goal this ambition actually is.
    goal: 'DESTABILIZE_RIVAL',
  }

  it('resolves the outcome using the clock\'s own goal, not the drifted live faction.goal', async () => {
    mocks.factionFindUnique.mockResolvedValueOnce(faction)

    await resolveCompletedAmbitions('camp1', simTurn(5), [clock])

    // A DESTABILIZE_RIVAL success applies resourceDelta -3 / stabilityDelta
    // +1 / militaryDelta +2 (see decideAmbitionOutcome) — an ENRICH success
    // would instead apply +10 / +2 / +0. If the bug were still present
    // (reading faction.goal === 'ENRICH'), this would assert the wrong
    // numbers.
    expect(mocks.factionUpdate).toHaveBeenCalledWith({
      where: { id: 'faction-drift-1' },
      data: { resources: 67, stability: 51, military: 100, threatLevel: 3 },
    })
  })

  it('does not skip agenda continuation just because the live faction.goal drifted off the ambition-eligible list', async () => {
    // Drift the faction all the way to a non-ambition goal (DEFEND) — under
    // the old faction.goal-based gate, continuation would never even be
    // considered for this completion, silently ending an agenda whose own
    // goal (DESTABILIZE_RIVAL) never changed.
    mocks.factionFindUnique.mockResolvedValueOnce({ ...faction, goal: 'DEFEND' })

    await resolveCompletedAmbitions('camp1', simTurn(5), [clock])

    expect(mocks.clockCreate).toHaveBeenCalledTimes(1)
    const created = mocks.clockCreate.mock.calls[0][0].data
    // The continuation clock stays pinned to the agenda's own goal, not the
    // faction's current (drifted) one.
    expect(created.goal).toBe('DESTABILIZE_RIVAL')
    expect(created.sourceFactionId).toBe('faction-drift-1')
    expect(created.agendaId).toBe('clock-drift-1')
  })

  it('falls back to faction.goal for a legacy clock with no stored goal', async () => {
    mocks.factionFindUnique.mockResolvedValueOnce({ ...faction, goal: 'DESTABILIZE_RIVAL' })

    await resolveCompletedAmbitions('camp1', simTurn(5), [{ ...clock, goal: null }])

    expect(mocks.factionUpdate).toHaveBeenCalledWith({
      where: { id: 'faction-drift-1' },
      data: { resources: 67, stability: 51, military: 100, threatLevel: 3 },
    })
  })
})
