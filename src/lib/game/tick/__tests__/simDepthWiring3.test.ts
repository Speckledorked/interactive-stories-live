import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    faction: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    factionDebt: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() },
    factionTie: { findMany: vi.fn(async () => []), upsert: vi.fn(), deleteMany: vi.fn() },
    activeWake: { findMany: vi.fn(async () => []), update: vi.fn(), create: vi.fn() },
    nPC: { findMany: vi.fn(async () => []), update: vi.fn(), updateMany: vi.fn() },
    war: { findMany: vi.fn(async () => []) },
  },
}))

import { prisma } from '@/lib/prisma'
import { decideWarDeclaration, decideWarJoiner, decideWarProgress } from '../warTick'
import { decideWarLosingPressure, decideFactionCollapse, decideFactionGoalReassessment } from '../factionTick'
import { decideDispositionDrift } from '../npcDispositionTick'
import { decideBeliefDrift } from '../beliefTick'
import { decideAmbitionTick, decideAmbitionOutcome } from '../ambitionTick'
import { planDebtRepayment, tickEconomy } from '../economyTick'
import { decideNpcTick } from '../npcTick'
import { decideExtraction } from '../logisticsTick'
import { decideMigration, ownerDistressPenalty } from '../migrationTick'
import { decideWakeDecayStep, tickWake } from '../wakeTick'
import { strainOneStep, tickFactionRelationships } from '../relationshipTick'
import { band } from '../types'
import { factionTieTable } from './tieFixtures'
import { simTurn } from '@/lib/game/turnClock'
import type { TickContext } from '../types'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: simTurn(10), factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any, ...overrides }
}

// Band edges the edge-case tests below pin: LOW < 34, MEDIUM 34-66, HIGH >= 67.
const declarationAttacker = (overrides: Record<string, any> = {}) => ({
  id: 'attacker',
  military: 80,
  ...overrides,
})
const declarationDefender = (overrides: Record<string, any> = {}) => ({
  id: 'defender',
  military: 80,
  ...overrides,
})
const contestedPrize = [{ id: 'loc1', ownerFactionId: 'defender', isContested: true }]

describe('sim-depth wiring batch 3', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ---- #1: debt repayment ------------------------------------------------
  describe('debt repayment', () => {
    const debtorById = new Map([['d', { isActive: true, resources: 60 }]])
    const debts = (rows: Array<{ id: string; amount: number; turnCreated: number }>) =>
      rows.map((r) => ({ ...r, creditorFactionId: 'c', debtorFactionId: 'd' }))

    it('repays the oldest debt first (turnCreated, then id)', () => {
      const plans = planDebtRepayment(
        debts([
          { id: 'new', amount: 30, turnCreated: 9 },
          { id: 'old', amount: 30, turnCreated: 5 },
        ]),
        debtorById
      )
      expect(plans).toHaveLength(1)
      expect(plans[0].debtId).toBe('old')
    })

    it('breaks turnCreated ties by debt id', () => {
      const plans = planDebtRepayment(
        debts([
          { id: 'b-debt', amount: 30, turnCreated: 5 },
          { id: 'a-debt', amount: 30, turnCreated: 5 },
        ]),
        debtorById
      )
      expect(plans[0].debtId).toBe('a-debt')
    })

    it('repays one debt per debtor per tick, capped at 10 and at the balance', () => {
      const plans = planDebtRepayment(debts([{ id: 'only', amount: 30, turnCreated: 5 }]), debtorById)
      expect(plans[0].repaid).toBe(10)
      expect(plans[0].newAmount).toBe(20)
      expect(plans[0].settled).toBe(false)
    })

    it('marks a fully repaid debt settled', () => {
      const plans = planDebtRepayment(debts([{ id: 'only', amount: 7, turnCreated: 5 }]), debtorById)
      expect(plans[0].repaid).toBe(7)
      expect(plans[0].settled).toBe(true)
    })

    it('caps the installment at 10 even for a just-solvent debtor', () => {
      // BROKE_THRESHOLD is 25, so a healthy debtor always has >= 25
      // resources: the 10-per-tick installment binds before resources
      // ever could. Resources stay in the min as a guard if the
      // threshold ever drops below the installment.
      const justSolvent = new Map([['d', { isActive: true, resources: 26 }]])
      const plans = planDebtRepayment(debts([{ id: 'only', amount: 30, turnCreated: 5 }]), justSolvent)
      expect(plans[0].repaid).toBe(10)
    })

    it('skips inactive and broke debtors entirely', () => {
      expect(
        planDebtRepayment(debts([{ id: 'x', amount: 30, turnCreated: 5 }]), new Map([['d', { isActive: false, resources: 60 }]]))
      ).toEqual([])
      expect(
        planDebtRepayment(debts([{ id: 'x', amount: 30, turnCreated: 5 }]), new Map([['d', { isActive: true, resources: 10 }]]))
      ).toEqual([])
    })
  })

  // ---- #2: goal-gated declarations --------------------------------------
  describe('goal-gated declarations', () => {
    it('refuses a declaration when the attacker goal is not an attacker goal', () => {
      const decision = decideWarDeclaration(
        declarationAttacker({ goal: 'CONSOLIDATE' }),
        declarationDefender(),
        contestedPrize
      )
      expect(decision.shouldDeclare).toBe(false)
      expect(decision.goalMismatch).toBe(true)
    })

    it('allows EXPAND and DESTABILIZE_RIVAL attackers', () => {
      for (const goal of ['EXPAND', 'DESTABILIZE_RIVAL'] as const) {
        const decision = decideWarDeclaration(
          declarationAttacker({ goal }),
          declarationDefender(),
          contestedPrize
        )
        expect(decision.shouldDeclare).toBe(true)
      }
    })

    it('preserves the old behavior when no goal is supplied', () => {
      const decision = decideWarDeclaration(declarationAttacker(), declarationDefender(), contestedPrize)
      expect(decision.shouldDeclare).toBe(true)
    })
  })

  // ---- #3: war momentum into collapse -----------------------------------
  describe('war momentum into collapse', () => {
    it('pressures the losing side only: negative momentum hits the attacker, positive the defender', () => {
      expect(decideWarLosingPressure(-50, 'ATTACKER')).toBeCloseTo(0.5)
      expect(decideWarLosingPressure(-50, 'DEFENDER')).toBe(0)
      expect(decideWarLosingPressure(50, 'DEFENDER')).toBeCloseTo(0.5)
      expect(decideWarLosingPressure(50, 'ATTACKER')).toBe(0)
      expect(decideWarLosingPressure(0, 'ATTACKER')).toBe(0)
    })

    it('adds up to 0.25 collapse roughness for a routed faction', () => {
      const routed = decideFactionCollapse({ stability: 10, resources: 100, military: 100, warLosingPressure: 1 })
      const calm = decideFactionCollapse({ stability: 10, resources: 100, military: 100 })
      expect(routed.collapses).toBe(true)
      expect(routed.roughness - calm.roughness).toBeCloseTo(0.25)
    })

    it('war and wake pressure stack additively, clamped at 1', () => {
      const both = decideFactionCollapse({ stability: 0, resources: 100, military: 100, activeWakeCount: 3, warLosingPressure: 1 })
      expect(both.roughness).toBeLessThanOrEqual(1)
      // stability 0 alone is already roughness 1; bumps cannot exceed the cap.
      expect(both.roughness).toBe(1)
    })
  })

  // ---- #4: mobilization affects NPCs and beliefs -------------------------
  describe('mobilization', () => {
    const disposition = { selfPreservation: 50, loyalty: 50, ambition: 50 }

    it('sharpens NPC self-preservation by 8 on mobilization', () => {
      const next = decideDispositionDrift(disposition, [{ kind: 'FACTION_MOBILIZED' }])
      expect(next.selfPreservation).toBe(58)
      expect(next.loyalty).toBe(50)
    })

    it('stirs belief zealotry by 4 on mobilization', () => {
      const beliefs = { aggression: 50, isolationism: 50, mercantilism: 50, zealotry: 50 }
      const next = decideBeliefDrift(beliefs, [{ kind: 'MOBILIZED' }])
      expect(next.zealotry).toBe(54)
      expect(next.aggression).toBe(50)
    })
  })

  // ---- #5: coalition joiner gates ---------------------------------------
  describe('coalition joiner gates', () => {
    const strong = { id: 's', name: 'Strong', military: 80 }

    it('rejects a joiner with a dovish leader', () => {
      expect(decideWarJoiner([{ ...strong, leaderAmbition: 10 }])).toBeNull()
    })

    it('rejects a joiner carrying a defaulted debt', () => {
      expect(decideWarJoiner([{ ...strong, isDefaulted: true }])).toBeNull()
    })

    it('rejects a joiner below the influence floor', () => {
      expect(decideWarJoiner([{ ...strong, influence: 10 }])).toBeNull()
    })

    it('rejects a joiner below the military threshold', () => {
      expect(decideWarJoiner([{ ...strong, military: 40 }])).toBeNull()
    })

    it('accepts a fully qualified joiner, strongest first', () => {
      const winner = decideWarJoiner([
        { id: 'b', name: 'B', military: 70, leaderAmbition: 60, influence: 60 },
        { id: 'a', name: 'A', military: 90, leaderAmbition: 60, influence: 60 },
      ])
      expect(winner?.id).toBe('a')
    })
  })

  // ---- #6: ambitions account for debt -----------------------------------
  describe('ambitions account for debt', () => {
    const faction = (overrides: Record<string, any> = {}) => ({
      name: 'Ashcrown',
      goal: 'EXPAND' as const,
      archetype: 'GENERIC' as const,
      resources: 80,
      hasActiveSpawnedClock: false,
      ...overrides,
    })

    it('blocks an ambition when debt drags effective resources below the HIGH bar', () => {
      const decision = decideAmbitionTick(faction({ outstandingDebt: 20 }))
      expect(decision.shouldSpawn).toBe(false)
    })

    it('allows the ambition when the debt-adjusted treasury still clears the bar', () => {
      const decision = decideAmbitionTick(faction({ outstandingDebt: 5 }))
      expect(decision.shouldSpawn).toBe(true)
    })

    it('preserves prior behavior when no debt is supplied', () => {
      const decision = decideAmbitionTick(faction())
      expect(decision.shouldSpawn).toBe(true)
    })
  })

  // ---- #7 + #15: faction goal logic sees war; the ambition-clock hold is
  // GONE (sim bite-tuning) — a faction CAN drift mid-clock now; the
  // replacement is the −15 resolution penalty, not a veto ----
  describe('faction goal reassessment', () => {
    const healthy = {
      resources: 70,
      stability: 70,
      military: 70,
      goal: 'EXPAND' as const,
      hasRival: true,
      turnsOnCurrentGoal: 10,
    }

    it('redirects an at-war faction to DEFEND before the commitment lock', () => {
      expect(decideFactionGoalReassessment({ ...healthy, atWar: true })).toBe('DEFEND')
    })

    it('no longer holds the goal while an ambition is in flight — drift is allowed', () => {
      // LOW resources would normally redirect an EXPAND faction to ENRICH
      // (past the commitment window). The removed hard hold kept it on
      // EXPAND whenever a live ambition clock existed; now the faction
      // reassesses like any other turn and the drift happens.
      const poor = { ...healthy, resources: 10 }
      expect(decideFactionGoalReassessment(poor)).toBe('ENRICH')
    })

    it('still redirects a genuinely collapsing faction to DEFEND — crisis never needed the clock', () => {
      expect(decideFactionGoalReassessment({ ...healthy, stability: 10 })).toBe('DEFEND')
    })

    it('still redirects an at-war faction to DEFEND', () => {
      expect(decideFactionGoalReassessment({ ...healthy, atWar: true })).toBe('DEFEND')
    })
  })

  // ---- the goal-drift resolution penalty (replaces the hold) ------------
  describe('goal-drift success penalty', () => {
    // Fixture roll 79 (stableHash('f1:drift-clock-14') % 100): ENRICH at
    // resources 80 is chance 80 un-drifted (success) and 65 drifted
    // (failure) — the same deterministic roll, only the flag moves.
    const driftedInput = { factionId: 'f1', clockId: 'drift-clock-14', factionName: 'Ashcrown', goal: 'ENRICH' as const, resources: 80, military: 80 }

    it('applies the −15 penalty only when the faction drifted mid-clock', () => {
      expect(decideAmbitionOutcome(driftedInput).success).toBe(true)
      expect(decideAmbitionOutcome({ ...driftedInput, goalDriftedMidClock: true }).success).toBe(false)
      expect(decideAmbitionOutcome({ ...driftedInput, goalDriftedMidClock: false }).success).toBe(true)
    })
  })

  // ---- #8: default penalizes debtor -------------------------------------
  describe('default penalizes the debtor', () => {
    it('costs an active defaulting debtor 15 influence, once per debtor per pass', async () => {
      vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([
        { id: 'debt1', creditorFactionId: 'creditor1', debtorFactionId: 'debtor1', amount: 20, turnCreated: 5 },
        { id: 'debt2', creditorFactionId: 'creditor2', debtorFactionId: 'debtor1', amount: 30, turnCreated: 5 },
      ] as any)
      // Order-independent dispatch: the handler issues several
      // faction.findMany calls with different select shapes.
      vi.mocked(prisma.faction.findMany).mockImplementation((async (args: any) => {
        const select = args?.select ?? {}
        if (select.influence !== undefined)
          return [{ id: 'debtor1', isActive: true, resources: 10, influence: 40 }] as any
        if (args?.where?.resources !== undefined) return [] as any
        return [{ id: 'debtor1', name: 'Broke Guild' }] as any
      }) as any)
      vi.mocked(prisma.faction.findUnique).mockResolvedValue({
        id: 'creditor1', name: 'Ashcrown', stability: 50, isActive: true,
      } as any)

      const result = await tickEconomy(baseCtx())

      const influenceChanges = result.changes.filter((c) => c.field === 'influence')
      // Two defaulted debts, one debtor: exactly one influence penalty.
      expect(influenceChanges).toHaveLength(1)
      expect(influenceChanges[0]).toMatchObject({
        entityId: 'debtor1',
        previousValue: 40,
        newValue: 25,
      })
      expect(influenceChanges[0].reason).toMatch(/defaults on 2 debts/)
    })
  })

  // ---- #9: NPC routines and contested/inactive conditions ----------------
  describe('NPC routines', () => {
    const npc = { id: 'npc1', goals: 'tend the forge', relationship: null, currentLocation: 'home', goalProgress: 10 }
    const graph = (contestedIds: string[]) => ({
      idByName: new Map([['home', 'home'], ['mill', 'mill'], ['forge', 'forge']]),
      contestedIds: new Set(contestedIds),
      edges: [] as Array<{ locationAId: string; locationBId: string; distance: number }>,
    })

    it('skips a contested work destination when a quieter neighbor exists', () => {
      const g = {
        idByName: new Map([['home', 'home'], ['mill', 'mill']]),
        contestedIds: new Set(['mill']),
        edges: [{ locationAId: 'home', locationBId: 'mill', distance: 1 }],
      }
      const decision = decideNpcTick(npc, 10, ['home', 'mill'], null, g, 9)
      // morning (9h) is active hours — work would be 'mill', but it is
      // contested, so the NPC stays home instead of marching in.
      expect(decision.nextLocation).not.toBe('mill')
    })

    it('accrues goal progress at half speed while in a contested location', () => {
      const free = decideNpcTick({ ...npc, currentLocation: 'home' }, 10, ['home', 'mill'], null, graph([]), 9)
      const contested = decideNpcTick({ ...npc, currentLocation: 'home' }, 10, ['home', 'mill'], null, graph(['home']), 9)
      const freeGain = free.newGoalProgress - npc.goalProgress
      const contestedGain = contested.newGoalProgress - npc.goalProgress
      expect(contestedGain).toBeCloseTo(freeGain / 2)
    })

    it('accrues goal progress at half speed for a faction that went inactive', () => {
      const active = decideNpcTick(npc, 10, ['home', 'mill'], { name: 'Guild', goal: 'EXPAND', isActive: true }, graph([]), 9)
      const inactive = decideNpcTick(npc, 10, ['home', 'mill'], { name: 'Guild', goal: 'EXPAND', isActive: false }, graph([]), 9)
      const activeGain = active.newGoalProgress - npc.goalProgress
      const inactiveGain = inactive.newGoalProgress - npc.goalProgress
      expect(inactiveGain).toBeCloseTo(activeGain / 2)
    })

    it('leaves truly unaffiliated NPCs (faction null) at full speed', () => {
      const unaffiliated = decideNpcTick(npc, 10, ['home', 'mill'], null, graph([]), 9)
      const affiliated = decideNpcTick(npc, 10, ['home', 'mill'], { name: 'Guild', goal: 'EXPAND' }, graph([]), 9)
      expect(unaffiliated.newGoalProgress).toBe(affiliated.newGoalProgress)
    })
  })

  // ---- #10: extraction accounts for location condition ------------------
  describe('extraction condition', () => {
    const loc = (overrides: Record<string, any> = {}) => ({
      locationId: 'mine',
      resourceSlots: ['iron', 'coal'],
      ownerFactionId: 'f1',
      population: 100,
      ...overrides,
    })

    it('yields nothing from an ABANDONED location', () => {
      expect(decideExtraction([loc({ conditionScore: 0 })], [])).toEqual([])
    })

    it('yields a quarter (floored) from a RUINED location', () => {
      const decisions = decideExtraction([loc({ conditionScore: 10 })], [])
      expect(decisions).toHaveLength(1)
      // 2 slots * gain-per-slot, quartered and floored — strictly less than
      // the full yield below.
      const full = decideExtraction([loc({ conditionScore: 80 })], [])[0].resourceGain
      expect(decisions[0].resourceGain).toBe(Math.floor(full / 4))
    })

    it('yields half (floored) from a DAMAGED location', () => {
      const decisions = decideExtraction([loc({ conditionScore: 40 })], [])
      expect(decisions).toHaveLength(1)
      const full = decideExtraction([loc({ conditionScore: 80 })], [])[0].resourceGain
      expect(decisions[0].resourceGain).toBe(Math.floor(full / 2))
    })

    it('yields in full when no condition is tracked', () => {
      const decisions = decideExtraction([loc()], [])
      expect(decisions).toHaveLength(1)
      expect(decisions[0].resourceGain).toBeGreaterThan(0)
    })
  })

  // ---- #11: migration accounts for owner resources/stability ------------
  describe('migration owner health', () => {
    it('penalizes equal-condition destinations per LOW owner signal', () => {
      expect(ownerDistressPenalty({ conditionScore: 80, ownerFactionResources: 10, ownerFactionStability: 10 } as any)).toBe(2)
      expect(ownerDistressPenalty({ conditionScore: 80, ownerFactionResources: 10, ownerFactionStability: 80 } as any)).toBe(1)
      expect(ownerDistressPenalty({ conditionScore: 80, ownerFactionResources: 80, ownerFactionStability: 80 } as any)).toBe(0)
      expect(ownerDistressPenalty({ conditionScore: 80 } as any)).toBe(0)
    })

    it('sorts a healthy-owner haven above an equal-condition distressed one', () => {
      const { npcMoves } = decideMigration(
        [{ id: 'ruins', name: 'Ruins', conditionScore: 10, population: null }],
        [
          { id: 'sick', name: 'Sick Town', conditionScore: 80, population: null, ownerFactionId: 'f-sick', ownerFactionResources: 10, ownerFactionStability: 80 },
          { id: 'well', name: 'Well Town', conditionScore: 80, population: null, ownerFactionId: 'f-well', ownerFactionResources: 80, ownerFactionStability: 80 },
        ],
        [{ id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true }]
      )
      expect(npcMoves[0].toLocationId).toBe('well')
    })
  })

  // ---- #12: wake resolution emits recovery ------------------------------
  describe('wake recovery', () => {
    const wake = (overrides: Record<string, any> = {}) => ({
      id: 'wake1',
      campaignId: 'campaign-1',
      affectedFactionId: 'f1',
      sourceEntityName: 'Mara Voss',
      totalStabilityPenalty: -12,
      currentTicks: 2,
      maxTicks: 3,
      resolvedAt: null,
      ...overrides,
    })

    beforeEach(() => {
      vi.mocked(prisma.nPC.findMany).mockResolvedValue([])
    })

    it('emits exactly one recovery change on the final decay step', async () => {
      vi.mocked(prisma.activeWake.findMany).mockResolvedValue([wake()] as any)
      vi.mocked(prisma.faction.findUnique).mockResolvedValue({ name: 'Ashcrown', stability: 40 } as any)

      const result = await tickWake(baseCtx())

      const recoveries = result.changes.filter((c) => c.field === 'stability' && c.origin === 'wake')
      expect(recoveries).toHaveLength(1)
      expect(recoveries[0]).toMatchObject({ entityId: 'f1', previousValue: 40 })
      expect(recoveries[0].reason).toMatch(/steadies as the wake of Mara Voss fades/)
    })

    it('stays silent on interim decay steps', async () => {
      vi.mocked(prisma.activeWake.findMany).mockResolvedValue([wake({ currentTicks: 0 })] as any)
      vi.mocked(prisma.faction.findUnique).mockResolvedValue({ name: 'Ashcrown', stability: 40 } as any)

      const result = await tickWake(baseCtx())

      expect(result.changes).toEqual([])
    })

    it('still reports the recovery in dry-run mode, without writing', async () => {
      vi.mocked(prisma.activeWake.findMany).mockResolvedValue([wake()] as any)
      vi.mocked(prisma.faction.findUnique).mockResolvedValue({ name: 'Ashcrown', stability: 40 } as any)

      const result = await tickWake(baseCtx({ dryRun: true }))

      expect(result.changes).toHaveLength(1)
      expect(prisma.faction.update).not.toHaveBeenCalled()
      expect(prisma.activeWake.update).not.toHaveBeenCalled()
    })

    it('computes the final step as resolved with the remainder restored', () => {
      const step = decideWakeDecayStep({ currentTicks: 2, maxTicks: 3, totalStabilityPenalty: -12 })
      expect(step.resolved).toBe(true)
      const interim = decideWakeDecayStep({ currentTicks: 0, maxTicks: 3, totalStabilityPenalty: -12 })
      expect(interim.resolved).toBe(false)
      // Total restored across all steps equals the original penalty.
      expect(interim.restoreAmount * 2 + step.restoreAmount).toBe(12)
    })
  })

  // ---- #13 + #14: ambition outcomes and treasury move loyalty -----------
  describe('disposition loyalty couplings', () => {
    const disposition = { selfPreservation: 50, loyalty: 50, ambition: 50 }

    it('raises loyalty 4 on ambition success', () => {
      expect(decideDispositionDrift(disposition, [{ kind: 'AMBITION_SUCCEEDED' }]).loyalty).toBe(54)
    })

    it('lowers loyalty 4 on ambition failure', () => {
      expect(decideDispositionDrift(disposition, [{ kind: 'AMBITION_FAILED' }]).loyalty).toBe(46)
    })

    it('lowers loyalty 8 on treasury collapse', () => {
      expect(decideDispositionDrift(disposition, [{ kind: 'TREASURY_COLLAPSED' }]).loyalty).toBe(42)
    })

    it('clamps loyalty at the rails', () => {
      const maxed = decideDispositionDrift({ ...disposition, loyalty: 99 }, [{ kind: 'AMBITION_SUCCEEDED' }])
      expect(maxed.loyalty).toBe(100)
      const floored = decideDispositionDrift({ ...disposition, loyalty: 1 }, [{ kind: 'AMBITION_FAILED' }])
      expect(floored.loyalty).toBe(0)
    })
  })

  // ---- #16: defaults strain relationships -------------------------------
  describe('defaults strain relationships', () => {
    it('steps ALLY -> NEUTRAL -> RIVAL, never past RIVAL', () => {
      expect(strainOneStep('ALLY')).toBe('NEUTRAL')
      expect(strainOneStep('NEUTRAL')).toBe('RIVAL')
      expect(strainOneStep('RIVAL')).toBe('RIVAL')
    })

    it('strains a fresh default exactly once, keyed on turnResolved', async () => {
      const a = { id: 'a', name: 'A', campaignId: 'campaign-1', goal: 'CONSOLIDATE', stability: 50, isActive: true }
      const b = { id: 'b', name: 'B', campaignId: 'campaign-1', goal: 'CONSOLIDATE', stability: 50, isActive: true }
      vi.mocked(prisma.faction.findMany)
        .mockResolvedValueOnce([a, b] as any) // roster
        .mockResolvedValueOnce([
          { id: 'a', name: 'A', isActive: true },
          { id: 'b', name: 'B', isActive: true },
        ] as any) // full roster
      vi.mocked(prisma.factionTie.findMany).mockResolvedValue(factionTieTable([['a', 'b', 'ALLY', 2]]) as any)
      vi.mocked(prisma.war.findMany).mockResolvedValue([])
      // A debt a owes b, defaulted LAST turn (economy runs later in
      // handler order, so this turn's defaults don't exist yet).
      vi.mocked(prisma.factionDebt.findMany).mockResolvedValue([
        { debtorFactionId: 'a', creditorFactionId: 'b' },
      ] as any)

      const result = await tickFactionRelationships(baseCtx())

      // ALLY strained to NEUTRAL: the edge is deleted, and the change
      // names the default as the cause.
      expect(prisma.factionTie.deleteMany).toHaveBeenCalledWith({
        where: { factionAId: 'a', factionBId: 'b' },
      })
      const change = result.changes.find((c) => c.field === 'relationship')
      expect(change).toMatchObject({ previousValue: 'ALLY', newValue: 'NEUTRAL' })
      expect(change!.reason).toMatch(/defaulted debt/)
    })

    it('ignores a default from two turns ago — each default strains once', async () => {
      const a = { id: 'a', name: 'A', campaignId: 'campaign-1', goal: 'CONSOLIDATE', stability: 50, isActive: true }
      const b = { id: 'b', name: 'B', campaignId: 'campaign-1', goal: 'CONSOLIDATE', stability: 50, isActive: true }
      vi.mocked(prisma.faction.findMany)
        .mockResolvedValueOnce([a, b] as any)
        .mockResolvedValueOnce([
          { id: 'a', name: 'A', isActive: true },
          { id: 'b', name: 'B', isActive: true },
        ] as any)
      vi.mocked(prisma.factionTie.findMany).mockResolvedValue(factionTieTable([['a', 'b', 'ALLY', 2]]) as any)
      vi.mocked(prisma.war.findMany).mockResolvedValue([])
      // No fresh defaults this pass.
      vi.mocked(prisma.factionDebt.findMany).mockResolvedValue([])

      const result = await tickFactionRelationships(baseCtx())

      expect(prisma.factionTie.deleteMany).not.toHaveBeenCalled()
      expect(result.changes).toEqual([])
    })
  })

  // ---- #17: refugees avoid rival territory ------------------------------
  describe('refugees avoid rival territory', () => {
    const npc = { id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true, factionId: 'f-home' }

    it('a named NPC deprioritizes destinations owned by their own faction rival', () => {
      // Graded -10, not exclusion: rival-town 85 -> 75 loses to safe-town 80.
      const { npcMoves } = decideMigration(
        [{ id: 'ruins', name: 'Ruins', conditionScore: 10, population: null, ownerFactionId: 'f-home' }],
        [
          { id: 'rival-town', name: 'Rival Town', conditionScore: 85, population: null, ownerFactionId: 'f-rival' },
          { id: 'safe-town', name: 'Safe Town', conditionScore: 80, population: null, ownerFactionId: 'f-friend' },
        ],
        [npc],
        [],
        new Map(),
        new Map([['f-home', 'f-rival']])
      )
      expect(npcMoves[0].toLocationId).toBe('safe-town')
    })

    it('a named NPC still picks the rival destination when it is clearly better', () => {
      // rival-town 95 -> 85 still beats safe-town 80: preference, not veto.
      const { npcMoves } = decideMigration(
        [{ id: 'ruins', name: 'Ruins', conditionScore: 10, population: null, ownerFactionId: 'f-home' }],
        [
          { id: 'rival-town', name: 'Rival Town', conditionScore: 95, population: null, ownerFactionId: 'f-rival' },
          { id: 'safe-town', name: 'Safe Town', conditionScore: 80, population: null, ownerFactionId: 'f-friend' },
        ],
        [npc],
        [],
        new Map(),
        new Map([['f-home', 'f-rival']])
      )
      expect(npcMoves[0].toLocationId).toBe('rival-town')
    })

    it('background population uses the source owner rival, not an NPC faction', () => {
      const { populationFlights } = decideMigration(
        [{ id: 'ruins', name: 'Ruins', conditionScore: 10, population: 500, ownerFactionId: 'f-home' }],
        [
          { id: 'rival-town', name: 'Rival Town', conditionScore: 85, population: null, ownerFactionId: 'f-rival' },
          { id: 'safe-town', name: 'Safe Town', conditionScore: 80, population: null, ownerFactionId: 'f-friend' },
        ],
        [],
        [],
        new Map(),
        new Map([['f-home', 'f-rival']])
      )
      expect(populationFlights[0].toLocationId).toBe('safe-town')
    })

    it('still flees to the rival destination when it is the only option', () => {
      const { npcMoves } = decideMigration(
        [{ id: 'ruins', name: 'Ruins', conditionScore: 10, population: null, ownerFactionId: 'f-home' }],
        [{ id: 'rival-town', name: 'Rival Town', conditionScore: 90, population: null, ownerFactionId: 'f-rival' }],
        [npc],
        [],
        new Map(),
        new Map([['f-home', 'f-rival']])
      )
      // Preference, not veto: routine beats paralysis.
      expect(npcMoves[0].toLocationId).toBe('rival-town')
    })
  })

  // ---- #18: stability affects declarations ------------------------------
  describe('stability affects declarations', () => {
    it('a LOW-stability attacker (33) refuses to declare', () => {
      const decision = decideWarDeclaration(
        declarationAttacker({ stability: 33 }),
        declarationDefender(),
        contestedPrize
      )
      expect(decision.shouldDeclare).toBe(false)
      expect(decision.stabilityHesitation).toBe(true)
    })

    it('a MEDIUM-stability attacker (34) is not stopped by stability', () => {
      expect(band(33)).toBe('LOW')
      expect(band(34)).toBe('MEDIUM')
      const decision = decideWarDeclaration(
        declarationAttacker({ stability: 34 }),
        declarationDefender(),
        contestedPrize
      )
      expect(decision.stabilityHesitation).toBeUndefined()
      expect(decision.shouldDeclare).toBe(true)
    })

    it('a crumbling defender lowers the attacker bar by 20, but the defender must still clear the floor', () => {
      // Attacker at 50 clears the reduced bar (67 - 20 = 47)...
      const weak = decideWarDeclaration(
        declarationAttacker({ military: 50 }),
        declarationDefender({ stability: 20 }),
        contestedPrize
      )
      expect(weak.shouldDeclare).toBe(true)
      // ...but a 45-military attacker still cannot declare.
      const tooWeak = decideWarDeclaration(
        declarationAttacker({ military: 45 }),
        declarationDefender({ stability: 20 }),
        contestedPrize
      )
      expect(tooWeak.shouldDeclare).toBe(false)
      // The defender's own floor never moves.
      const weakDefender = decideWarDeclaration(
        declarationAttacker({ military: 80 }),
        declarationDefender({ military: 50, stability: 20 }),
        contestedPrize
      )
      expect(weakDefender.shouldDeclare).toBe(false)
    })
  })

  // ---- #19: self-preservation affects declarations ----------------------
  describe('self-preservation affects declarations', () => {
    it('a leader at 70 self-preservation vetoes the declaration', () => {
      const decision = decideWarDeclaration(
        declarationAttacker({ leaderSelfPreservation: 70 }),
        declarationDefender(),
        contestedPrize
      )
      expect(decision.shouldDeclare).toBe(false)
      expect(decision.selfPreservationVeto).toBe(true)
    })

    it('a leader at 69 does not veto', () => {
      const decision = decideWarDeclaration(
        declarationAttacker({ leaderSelfPreservation: 69 }),
        declarationDefender(),
        contestedPrize
      )
      expect(decision.selfPreservationVeto).toBeUndefined()
      expect(decision.shouldDeclare).toBe(true)
    })

    it('a leaderless faction keeps the prior behavior', () => {
      const decision = decideWarDeclaration(declarationAttacker(), declarationDefender(), contestedPrize)
      expect(decision.shouldDeclare).toBe(true)
    })
  })

  // ---- #20: winter raises attrition -------------------------------------
  describe('winter attrition', () => {
    it('adds two military attrition to both sides in winter', () => {
      const summer = decideWarProgress({ id: 'war1' }, { military: 80 }, { military: 80 }, 5, undefined, undefined, undefined, 'summer')
      const winter = decideWarProgress({ id: 'war1' }, { military: 80 }, { military: 80 }, 5, undefined, undefined, undefined, 'winter')
      expect(winter.attackerMilitaryDelta).toBe(summer.attackerMilitaryDelta - 2)
      expect(winter.defenderMilitaryDelta).toBe(summer.defenderMilitaryDelta - 2)
      expect(winter.attackerMilitaryDelta).toBe(-4)
      expect(winter.defenderMilitaryDelta).toBe(-4)
    })

    it('preserves prior behavior with no season', () => {
      const noSeason = decideWarProgress({ id: 'war1' }, { military: 80 }, { military: 80 }, 5)
      const summer = decideWarProgress({ id: 'war1' }, { military: 80 }, { military: 80 }, 5, undefined, undefined, undefined, 'summer')
      expect(noSeason.attackerMilitaryDelta).toBe(summer.attackerMilitaryDelta)
      expect(noSeason.defenderMilitaryDelta).toBe(summer.defenderMilitaryDelta)
    })
  })
})
