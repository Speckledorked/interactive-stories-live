// src/lib/game/tick/economyTick.ts
// World Sim #111 — economic contagion & cascading collapse between
// factions.
//
// No faction-to-faction debt/credit model existed before this — the only
// Debt model is Character-centric (a required FK to Character) and can't
// be repurposed for a genuine faction-to-faction obligation, hence the new
// FactionDebt model (schema.prisma).
//
// Two origination paths, both decided in scope for this issue:
//
// (a) "factionPayout.ts's existing partial-pay/shortfall logging
//     automatically creates a real FactionDebt row instead of only
//     logging it." Taken literally this doesn't map cleanly onto a
//     faction-to-faction shape: factionPayout.ts's one real call site
//     (questRewards.ts) is a faction paying GOLD to CHARACTERS, and the
//     "payer" there IS the quest's own giver faction (resolvePayingFaction
//     falls back to giverFactionId) — there is no second faction to be a
//     creditor. Rather than inventing a fictional creditor, this reuses
//     factionPayout.ts's actual shortfall/capacity machinery
//     (assessPayout, MAX_RESOURCE_COST_PER_PAYOUT) as the capacity check
//     for the one genuine faction-to-faction transfer this issue adds:
//     decideLoanExtension below. The "instead of only logging it, creates
//     a real row" part is honored exactly — the same pure shortfall math
//     that used to only produce a discarded log line (describeDefault)
//     now determines the real, persisted FactionDebt.amount for a loan.
// (b) A faction below BROKE_THRESHOLD with a still-active ALLY that can
//     afford to help gets bailed out automatically — decideLoanExtension.
//
// Defaulting: an OUTSTANDING FactionDebt whose debtor has since collapsed
// OR is still broke (BROKE_THRESHOLD again) flips to DEFAULTED and
// applies a capped stability hit to its creditor via a real ActiveWake
// row (#103, sourceType 'FACTION_DEFAULT') — reusing that decay mechanism
// rather than inventing a parallel one-time-only penalty, since a
// cascading default is the same kind of "shockwave to a related faction"
// tickWake's own collapse-ripple case already models.
//
// Ordering: this handler MUST run after tickWake in TICK_HANDLERS
// (worldTick.ts), not before — tickWake's own decay phase runs
// unconditionally over every unresolved ActiveWake row each tick, and if
// this handler created one before tickWake ran this same pass, it would
// get decayed the same turn it was born (the exact same-tick double-count
// tickWake's own internal decay-before-create ordering exists to avoid).

import { TickContext, TickHandlerResult, WorldChange, clamp, findAllyIds } from './types'
import { assessPayout, BROKE_THRESHOLD, GOLD_PER_RESOURCE_POINT, MAX_RESOURCE_COST_PER_PAYOUT } from '../factionPayout'
import { isUniqueConstraintViolation } from '../worldUpdaters/uniqueConstraintGuard'

// A lender needs a real buffer above BROKE_THRESHOLD before it's asked to
// help someone else — comfortably healthy, not merely solvent.
const LOAN_LENDER_MIN_RESOURCES = 60

// Same rough scale as wakeTick's COLLAPSE_RIPPLE_BASE_PENALTY (5) — a
// defaulted debt is a comparable shockwave to a related faction.
const DEFAULT_CASCADE_BASE_PENALTY = 6
// "Applies a CAPPED stability hit" per the issue text — no number of
// simultaneously-defaulting debts can exceed this in one pass.
const MAX_CASCADE_PENALTY = 15
// Used when no #103 collapse roughness is on record for this debtor this
// turn (a broke-but-not-collapsed default, or an already-old collapse).
const DEFAULT_ROUGHNESS = 0.4
// Same decay window #103 already established.
const CASCADE_DECAY_TURNS = 5

export interface LoanCandidate {
  factionId: string
  resources: number
}

export interface LoanDecision {
  lenderFactionId: string
  amount: number
}

/**
 * Pure — which ally (if any) extends a loan to a broke faction, and how
 * much. Picks the richest capable ally, ties broken by id. Reuses
 * factionPayout.ts's exact shortfall/capacity math: a lender never fronts
 * more than MAX_RESOURCE_COST_PER_PAYOUT resource points, the same
 * ceiling an ordinary quest payout already respects, so a loan can never
 * drain a lender any harder than a payout already could.
 */
export function decideLoanExtension(broke: LoanCandidate, potentialLenders: LoanCandidate[]): LoanDecision | null {
  if (broke.resources >= BROKE_THRESHOLD) return null

  const lender = [...potentialLenders]
    .filter((l) => l.resources >= LOAN_LENDER_MIN_RESOURCES)
    .sort((a, b) => b.resources - a.resources || a.factionId.localeCompare(b.factionId))[0]
  if (!lender) return null

  const promisedGold = MAX_RESOURCE_COST_PER_PAYOUT * GOLD_PER_RESOURCE_POINT
  const assessment = assessPayout(promisedGold, lender.resources)
  if (assessment.resourceCost <= 0) return null

  return { lenderFactionId: lender.factionId, amount: assessment.resourceCost }
}

/**
 * Pure — the capped stability penalty applied to ONE creditor for a batch
 * of its debts defaulting in the same pass. Scales with how many debts
 * defaulted at once and how rough the underlying collapse was (0-1,
 * defaults to DEFAULT_ROUGHNESS when the default wasn't collapse-driven),
 * but never exceeds MAX_CASCADE_PENALTY regardless.
 */
export function decideDefaultCascade(defaultedDebtCount: number, roughness: number = DEFAULT_ROUGHNESS): number {
  const magnitude = Math.min(MAX_CASCADE_PENALTY, DEFAULT_CASCADE_BASE_PENALTY * defaultedDebtCount * (0.5 + roughness))
  return -Math.round(magnitude)
}

export async function tickEconomy(ctx: TickContext): Promise<TickHandlerResult> {
  const changes: WorldChange[] = []

  // 1. Default outstanding debts whose debtor has collapsed or gone broke.
  // Only debts created on a PRIOR turn are eligible — so a loan
  // originated later in this same pass (step 2) never immediately
  // defaults the instant it's created.
  const outstandingDebts = await ctx.db.factionDebt.findMany({
    where: { campaignId: ctx.campaignId, status: 'OUTSTANDING', turnCreated: { lt: ctx.turnNumber } },
    select: { id: true, creditorFactionId: true, debtorFactionId: true },
  })

  if (outstandingDebts.length > 0) {
    const debtorIds = [...new Set(outstandingDebts.map((d) => d.debtorFactionId))]
    const debtors = await ctx.db.faction.findMany({
      where: { id: { in: debtorIds } },
      select: { id: true, isActive: true, resources: true },
    })
    const debtorById = new Map(debtors.map((d) => [d.id, d]))

    const defaultingDebts = outstandingDebts.filter((debt) => {
      const debtor = debtorById.get(debt.debtorFactionId)
      return !debtor || !debtor.isActive || debtor.resources < BROKE_THRESHOLD
    })

    if (defaultingDebts.length > 0) {
      if (!ctx.dryRun) {
        await ctx.db.factionDebt.updateMany({
          where: { id: { in: defaultingDebts.map((d) => d.id) } },
          data: { status: 'DEFAULTED', resolvedAt: new Date(), turnResolved: ctx.turnNumber },
        })
      }

      const debtsByCreditor = new Map<string, typeof defaultingDebts>()
      for (const debt of defaultingDebts) {
        if (!debtsByCreditor.has(debt.creditorFactionId)) debtsByCreditor.set(debt.creditorFactionId, [])
        debtsByCreditor.get(debt.creditorFactionId)!.push(debt)
      }

      for (const [creditorId, debts] of debtsByCreditor) {
        const creditor = await ctx.db.faction.findUnique({
          where: { id: creditorId },
          select: { id: true, name: true, stability: true, isActive: true },
        })
        if (!creditor || !creditor.isActive) continue

        // Reuse #103's collapse roughness for whichever defaulting debtor
        // actually collapsed this campaign's recent history, if any.
        const collapseRoughness = debts
          .map((d) => ctx.collapseRoughnessByFactionId?.get(d.debtorFactionId))
          .find((r): r is number => r !== undefined)
        const penalty = decideDefaultCascade(debts.length, collapseRoughness ?? DEFAULT_ROUGHNESS)
        const newStability = clamp(creditor.stability + penalty, 0, 100)

        if (!ctx.dryRun) {
          try {
            await ctx.db.activeWake.create({
              data: {
                campaignId: ctx.campaignId,
                sourceType: 'FACTION_DEFAULT',
                sourceEntityId: [...debts.map((d) => d.id)].sort().join(','),
                sourceEntityName: `${debts.length} defaulted debt(s)`,
                affectedFactionId: creditor.id,
                totalStabilityPenalty: penalty,
                maxTicks: CASCADE_DECAY_TURNS,
              },
            })
          } catch (error) {
            if (!isUniqueConstraintViolation(error)) throw error
          }
          await ctx.db.faction.update({ where: { id: creditor.id }, data: { stability: newStability } })
        }

        changes.push({
          entityType: 'FACTION',
          entityId: creditor.id,
          entityName: creditor.name,
          campaignId: ctx.campaignId,
          field: 'stability',
          previousValue: creditor.stability,
          newValue: newStability,
          reason:
            debts.length > 1
              ? `${creditor.name} reels as ${debts.length} debts default against it`
              : `${creditor.name} reels as a debt defaults against it`,
          significant: true,
          importance: 'NORMAL',
          origin: 'wake',
        })
      }
    }
  }

  // 2. Originate new loans: a broke, active faction with a still-active
  // ALLY that can afford to help, and no outstanding debt of its own yet
  // (at most one loan in flight per debtor at a time).
  const brokeFactions = await ctx.db.faction.findMany({
    where: { campaignId: ctx.campaignId, isActive: true, resources: { lt: BROKE_THRESHOLD } },
    select: { id: true, name: true, resources: true, relationships: true },
  })

  for (const broke of brokeFactions) {
    const existingDebt = await ctx.db.factionDebt.findFirst({
      where: { campaignId: ctx.campaignId, debtorFactionId: broke.id, status: 'OUTSTANDING' },
      select: { id: true },
    })
    if (existingDebt) continue

    const allyIds = findAllyIds(broke.relationships)
    if (allyIds.length === 0) continue

    const allies = await ctx.db.faction.findMany({
      where: { id: { in: allyIds }, isActive: true },
      select: { id: true, name: true, resources: true },
    })
    if (allies.length === 0) continue

    const decision = decideLoanExtension(
      { factionId: broke.id, resources: broke.resources },
      allies.map((a) => ({ factionId: a.id, resources: a.resources }))
    )
    if (!decision) continue

    const lender = allies.find((a) => a.id === decision.lenderFactionId)!
    const newBrokeResources = clamp(broke.resources + decision.amount, 0, 100)
    const newLenderResources = clamp(lender.resources - decision.amount, 0, 100)

    if (!ctx.dryRun) {
      // #238 (adversarial audit): the findFirst check above and this
      // create used to be the only guard against a debtor getting a
      // second OUTSTANDING FactionDebt — no DB-level constraint backed it.
      // A real partial unique index now does (see the migration and
      // schema.prisma's FactionDebt comment). Since this loop is already
      // sequential within the tick's own transaction, this violation isn't
      // reachable in practice today — but an uncaught P2002 here would
      // abort the ENTIRE world-tick transaction (Postgres fails the whole
      // transaction on any unhandled statement error, not just this loan),
      // which is a strictly worse outcome than the bug the constraint
      // exists to prevent. Same swallow-and-skip pattern this file already
      // uses for the ActiveWake creation above.
      try {
        await ctx.db.factionDebt.create({
          data: {
            campaignId: ctx.campaignId,
            creditorFactionId: lender.id,
            debtorFactionId: broke.id,
            amount: decision.amount,
            turnCreated: ctx.turnNumber,
          },
        })
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error
        continue
      }
      await ctx.db.faction.update({ where: { id: lender.id }, data: { resources: newLenderResources } })
      await ctx.db.faction.update({ where: { id: broke.id }, data: { resources: newBrokeResources } })
    }

    changes.push({
      entityType: 'FACTION',
      entityId: broke.id,
      entityName: broke.name,
      campaignId: ctx.campaignId,
      field: 'resources',
      previousValue: broke.resources,
      newValue: newBrokeResources,
      reason: `${lender.name} extends emergency aid to its struggling ally ${broke.name}`,
      significant: true,
      importance: 'NORMAL',
    })
  }

  return { changes }
}
