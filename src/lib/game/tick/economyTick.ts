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

// roster-exempt: debts and loans are per-CONTRACT, not per-faction — a
// creditor outside this tick's roster is still owed money, and a loan
// maturing must default on schedule regardless of whose turn it is to be
// simulated. Capping this would make repayment depend on rotation luck.

import { TickContext, TickHandlerResult, WorldChange, clamp, findAllyIds } from './types'
import { TIE_INCLUDE, factionTies } from '../tieGraph'
import { assessPayout, BROKE_THRESHOLD, GOLD_PER_RESOURCE_POINT, MAX_RESOURCE_COST_PER_PAYOUT } from '../factionPayout'
import { isUniqueConstraintViolation } from '../worldUpdaters/uniqueConstraintGuard'
import { planCycleNetting } from '../factionDebtGraph'

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
// #311: a debtor whose debt just defaulted (this same tick or recently)
// is excluded from new-loan eligibility for this many turns — without it,
// a defaulted debt only flips OUTSTANDING -> DEFAULTED, so step 2's
// existing-debt check (which only ever looked at OUTSTANDING) let the
// very same debtor immediately re-borrow, in the same tick, from any
// still-solvent ally (frequently the creditor it just stiffed, since the
// cascade penalty only ever hits the creditor's stability, never the
// debtor's own resources). Reuses CASCADE_DECAY_TURNS's window: a
// defaulted debtor stays untrustworthy for as long as the stability
// shockwave from that default is still being felt.
const LOAN_DEFAULT_COOLDOWN_TURNS = CASCADE_DECAY_TURNS

// A healthy debtor services its obligations instead of sitting on them:
// one installment per tick against its oldest OUTSTANDING debt. A fixed
// amount, not a fraction — fractions asymptote and never clear a debt,
// while a fixed installment amortizes deterministically to PAID.
const DEBT_REPAYMENT_PER_TICK = 10
// Defaulting has to cost the DEBTOR something real, or debt is free money
// and the creditor's wake is the only consequence in the whole system. An
// influence hit feeds straight back into declaration gating
// (INFLUENCE_DECLARATION_FLOOR in warTick.ts): a faction that stiffs its
// creditors can't rally anyone into its next war.
const DEFAULT_DEBTOR_INFLUENCE_PENALTY = 15

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

export interface RepayableDebt {
  id: string
  creditorFactionId: string
  debtorFactionId: string
  amount: number
  turnCreated: number
}

export interface DebtRepaymentDecision {
  debtId: string
  debtorFactionId: string
  creditorFactionId: string
  repaid: number
  newAmount: number
  settled: boolean
}

/**
 * Pure — which debts get a repayment installment this tick. One repayment
 * per debtor, against its OLDEST outstanding debt (turnCreated, then id —
 * deterministic, never dependent on query row order). Only healthy debtors
 * pay: a broke or collapsed debtor's obligations were already routed to
 * defaulting, and a debtor that can't cover the full installment pays what
 * it has rather than nothing. Debts already settled or defaulted in this
 * same pass are the caller's job to exclude.
 */
export function planDebtRepayment(
  debts: RepayableDebt[],
  debtors: Map<string, { isActive: boolean; resources: number }>
): DebtRepaymentDecision[] {
  const oldestByDebtor = new Map<string, RepayableDebt>()
  for (const debt of debts) {
    if (debt.amount <= 0) continue
    const debtor = debtors.get(debt.debtorFactionId)
    if (!debtor || !debtor.isActive || debtor.resources < BROKE_THRESHOLD) continue
    const current = oldestByDebtor.get(debt.debtorFactionId)
    if (
      !current ||
      debt.turnCreated < current.turnCreated ||
      (debt.turnCreated === current.turnCreated && debt.id < current.id)
    ) {
      oldestByDebtor.set(debt.debtorFactionId, debt)
    }
  }

  const decisions: DebtRepaymentDecision[] = []
  for (const debt of oldestByDebtor.values()) {
    const debtor = debtors.get(debt.debtorFactionId)!
    const repaid = Math.min(DEBT_REPAYMENT_PER_TICK, debt.amount, debtor.resources)
    if (repaid <= 0) continue
    decisions.push({
      debtId: debt.id,
      debtorFactionId: debt.debtorFactionId,
      creditorFactionId: debt.creditorFactionId,
      repaid,
      newAmount: debt.amount - repaid,
      settled: debt.amount - repaid === 0,
    })
  }
  // Deterministic emission order — the same input always replays the same
  // sequence of writes.
  decisions.sort((a, b) => a.debtId.localeCompare(b.debtId))
  return decisions
}

export async function tickEconomy(ctx: TickContext): Promise<TickHandlerResult> {
  const changes: WorldChange[] = []

  // 0. Cancel debt that runs in a circle (#371).
  //
  // Runs BEFORE defaulting, and the order is the point: netting used to
  // be the only way an obligation could leave this system without
  // someone collapsing — now healthy debtors also amortize toward PAID
  // in the repayment step below. Netting still runs first because it
  // settles real debt while moving no resources at all, which is
  // precisely why it can rescue a faction too broke to pay anyone:
  // if A owes B, B owes C and C owes A, part of what each "owes" is
  // owed back around the ring, and cancelling the common minimum
  // settles real debt for all of them. Defaulting first would destroy
  // exactly the debts most worth netting.
  //
  // One fetch serves both this step and the defaulting below — same
  // campaign, same OUTSTANDING status, same `turnCreated < turnNumber`
  // guard (so a loan originated in step 2 can't be created and then netted
  // or defaulted inside the same pass).
  const outstandingDebts = await ctx.db.factionDebt.findMany({
    where: { campaignId: ctx.campaignId, status: 'OUTSTANDING', turnCreated: { lt: ctx.turnNumber } },
    // turnCreated is selected (not just filtered on) so repayment below
    // can order a debtor's obligations oldest-first deterministically.
    select: { id: true, creditorFactionId: true, debtorFactionId: true, amount: true, turnCreated: true },
  })

  const nettings = planCycleNetting(outstandingDebts)
  // Anything netting just settled is gone; it must not also default below.
  const settledByNetting = new Set(nettings.filter((n) => n.settled).map((n) => n.debtId))

  if (nettings.length > 0) {
    const involvedIds = [...new Set(outstandingDebts.map((d) => d.creditorFactionId))]
    const involved = await ctx.db.faction.findMany({
      where: { id: { in: involvedIds } },
      select: { id: true, name: true },
    })
    const nameById = new Map(involved.map((f) => [f.id, f.name]))
    const debtById = new Map(outstandingDebts.map((d) => [d.id, d]))

    for (const netting of nettings) {
      const debt = debtById.get(netting.debtId)
      if (!debt) continue

      if (!ctx.dryRun) {
        await ctx.db.factionDebt.update({
          where: { id: netting.debtId },
          data: netting.settled
            ? { amount: 0, status: 'PAID', resolvedAt: new Date(), turnResolved: ctx.turnNumber }
            : { amount: netting.newAmount },
        })
      }

      const creditorName = nameById.get(debt.creditorFactionId) ?? 'a faction'
      changes.push({
        entityType: 'FACTION',
        entityId: debt.creditorFactionId,
        entityName: creditorName,
        campaignId: ctx.campaignId,
        field: 'debt',
        previousValue: netting.previousAmount,
        newValue: netting.newAmount,
        reason: netting.settled
          ? `A debt owed to ${creditorName} is written off against what it owed in turn`
          : `A debt owed to ${creditorName} is partly written off against what it owed in turn`,
        // Settling an obligation outright is worth remembering; shaving one
        // down is the routine half of the same bookkeeping.
        significant: netting.settled,
        importance: 'NORMAL',
      })
    }
  }

  // 1. Default outstanding debts whose debtor has collapsed or gone broke.
  // Reads the same fetch step 0 used, minus anything netting already
  // settled — a debt cancelled against a circle no longer exists to
  // default.
  const defaultableDebts = outstandingDebts.filter((d) => !settledByNetting.has(d.id))

  // Hoisted for the repayment step below: which debtors are healthy, and
  // which debts defaulted in this pass (they must not also be repaid).
  const debtorById = new Map<string, { id: string; isActive: boolean; resources: number; influence: number }>()
  const defaultedDebtIds = new Set<string>()

  if (defaultableDebts.length > 0) {
    const debtorIds = [...new Set(defaultableDebts.map((d) => d.debtorFactionId))]
    const debtors = await ctx.db.faction.findMany({
      where: { id: { in: debtorIds } },
      // influence is selected here (not just resources) so the defaulting
      // debtor's own penalty below doesn't need a second read.
      select: { id: true, isActive: true, resources: true, influence: true },
    })
    for (const debtor of debtors) debtorById.set(debtor.id, debtor)

    const defaultingDebts = defaultableDebts.filter((debt) => {
      const debtor = debtorById.get(debt.debtorFactionId)
      return !debtor || !debtor.isActive || debtor.resources < BROKE_THRESHOLD
    })

    if (defaultingDebts.length > 0) {
      for (const debt of defaultingDebts) defaultedDebtIds.add(debt.id)
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
          wakeSourceType: 'FACTION_DEFAULT',
        })
      }

      // The debtor pays too — in influence, alongside the creditor's
      // stability wake. A faction that stiffs its creditors finds its
      // word carries less weight: this feeds warTick's
      // INFLUENCE_DECLARATION_FLOOR, so a serial defaulter can't rally
      // anyone into its next war. One penalty per defaulting debtor, not
      // per debt — the reputational hit is for the act, and the creditor
      // loop above already scales with debt count.
      const debtsByDebtor = new Map<string, typeof defaultingDebts>()
      for (const debt of defaultingDebts) {
        if (!debtsByDebtor.has(debt.debtorFactionId)) debtsByDebtor.set(debt.debtorFactionId, [])
        debtsByDebtor.get(debt.debtorFactionId)!.push(debt)
      }
      const defaulterNames = await ctx.db.faction.findMany({
        where: { id: { in: Array.from(debtsByDebtor.keys()) } },
        select: { id: true, name: true },
      })
      const defaulterNameById = new Map(defaulterNames.map((f) => [f.id, f.name]))
      for (const [debtorId, debts] of debtsByDebtor) {
        const debtor = debtorById.get(debtorId)
        if (!debtor || !debtor.isActive) continue
        const newInfluence = clamp(debtor.influence - DEFAULT_DEBTOR_INFLUENCE_PENALTY, 0, 100)
        if (!ctx.dryRun) {
          await ctx.db.faction.update({ where: { id: debtorId }, data: { influence: newInfluence } })
        }
        const debtorName = defaulterNameById.get(debtorId) ?? 'a faction'
        changes.push({
          entityType: 'FACTION',
          entityId: debtorId,
          entityName: debtorName,
          campaignId: ctx.campaignId,
          field: 'influence',
          previousValue: debtor.influence,
          newValue: newInfluence,
          reason:
            debts.length > 1
              ? `${debtorName} defaults on ${debts.length} debts — its word carries less weight now`
              : `${debtorName} defaults on its debt — its word carries less weight now`,
          significant: true,
          importance: 'NORMAL',
        })
      }
    }
  }

  // 1b. Healthy debtors service their oldest outstanding debt — a fixed
  // installment per tick, resources moving from debtor to creditor. Runs
  // after defaulting (a debt that defaulted this pass no longer exists to
  // be repaid) and before new-loan origination (a faction that just
  // cleared its books may legitimately re-qualify for aid). Debts settled
  // by netting above are excluded the same way the defaulting step
  // excludes them.
  const repayableDebts = outstandingDebts.filter(
    (d) => !settledByNetting.has(d.id) && !defaultedDebtIds.has(d.id)
  )
  const repayments = planDebtRepayment(repayableDebts, debtorById)
  if (repayments.length > 0) {
    const partyIds = [...new Set(repayments.flatMap((r) => [r.debtorFactionId, r.creditorFactionId]))]
    const parties = await ctx.db.faction.findMany({
      where: { id: { in: partyIds } },
      select: { id: true, name: true, resources: true },
    })
    const nameById = new Map(parties.map((f) => [f.id, f.name]))
    // Working balances, not re-reads: one faction can appear in several
    // repayments this pass (debtor on one, creditor on another), and each
    // installment must see the last one's effect.
    const workingResources = new Map(parties.map((f) => [f.id, f.resources]))

    for (const repayment of repayments) {
      const debtorBalance = workingResources.get(repayment.debtorFactionId)
      const creditorBalance = workingResources.get(repayment.creditorFactionId)
      if (debtorBalance === undefined || creditorBalance === undefined) continue
      const newDebtorResources = clamp(debtorBalance - repayment.repaid, 0, 100)
      const newCreditorResources = clamp(creditorBalance + repayment.repaid, 0, 100)
      workingResources.set(repayment.debtorFactionId, newDebtorResources)
      workingResources.set(repayment.creditorFactionId, newCreditorResources)

      if (!ctx.dryRun) {
        await ctx.db.factionDebt.update({
          where: { id: repayment.debtId },
          data: repayment.settled
            ? { amount: 0, status: 'PAID', resolvedAt: new Date(), turnResolved: ctx.turnNumber }
            : { amount: repayment.newAmount },
        })
        await ctx.db.faction.update({ where: { id: repayment.debtorFactionId }, data: { resources: newDebtorResources } })
        await ctx.db.faction.update({ where: { id: repayment.creditorFactionId }, data: { resources: newCreditorResources } })
      }

      const debtorName = nameById.get(repayment.debtorFactionId) ?? 'a faction'
      const creditorName = nameById.get(repayment.creditorFactionId) ?? 'a faction'
      changes.push({
        entityType: 'FACTION',
        entityId: repayment.debtorFactionId,
        entityName: debtorName,
        campaignId: ctx.campaignId,
        field: 'debt',
        previousValue: repayment.repaid + repayment.newAmount,
        newValue: repayment.newAmount,
        reason: repayment.settled
          ? `${debtorName} repays its debt to ${creditorName} in full`
          : `${debtorName} repays ${repayment.repaid} toward its debt to ${creditorName}`,
        // Clearing an obligation outright is worth remembering; an
        // installment is routine bookkeeping on the way there.
        significant: repayment.settled,
        importance: 'NORMAL',
      })
      // The resources actually moved too — the repayment step wrote both
      // balances via faction.update, but only the debt change above was
      // reported, so the treasury-collapse classifier (which reads
      // faction resources events) never saw a repayment drain a debtor to
      // LOW. Two resources changes per repayment fix the read, in the same
      // array as the debt change. significant: false keeps installment
      // bookkeeping out of history/rumor spam; the disposition reader has
      // no significance filter, so it still sees the transition.
      changes.push({
        entityType: 'FACTION',
        entityId: repayment.debtorFactionId,
        entityName: debtorName,
        campaignId: ctx.campaignId,
        field: 'resources',
        previousValue: debtorBalance,
        newValue: newDebtorResources,
        reason: `${debtorName} repays ${repayment.repaid} resources to ${creditorName}`,
        significant: false,
        importance: 'MINOR',
      })
      changes.push({
        entityType: 'FACTION',
        entityId: repayment.creditorFactionId,
        entityName: creditorName,
        campaignId: ctx.campaignId,
        field: 'resources',
        previousValue: creditorBalance,
        newValue: newCreditorResources,
        reason: `${debtorName} repays ${repayment.repaid} resources to ${creditorName}`,
        significant: false,
        importance: 'MINOR',
      })
    }
  }

  // 2. Originate new loans: a broke, active faction with a still-active
  // ALLY that can afford to help, and no outstanding debt of its own yet
  // (at most one loan in flight per debtor at a time).
  const brokeFactions = await ctx.db.faction.findMany({
    where: { campaignId: ctx.campaignId, isActive: true, resources: { lt: BROKE_THRESHOLD } },
    select: { id: true, name: true, resources: true, ...TIE_INCLUDE },
  })

  for (const broke of brokeFactions) {
    // #311: excludes both an already-in-flight loan (OUTSTANDING) and a
    // recent default (DEFAULTED within the cooldown window, including one
    // that defaulted earlier in this very same tick — turnResolved is set
    // to ctx.turnNumber by step 1 above, and ctx.turnNumber - turnNumber
    // is trivially 0, inside the window).
    const existingDebt = await ctx.db.factionDebt.findFirst({
      where: {
        campaignId: ctx.campaignId,
        debtorFactionId: broke.id,
        OR: [
          { status: 'OUTSTANDING' },
          { status: 'DEFAULTED', turnResolved: { gte: ctx.turnNumber - LOAN_DEFAULT_COOLDOWN_TURNS } },
          // #418: a DEFAULTED row with a NULL turnResolved was silently
          // excluded by the comparison above — SQL comparisons against
          // NULL are never true — so a legacy defaulter (or any row
          // written before turnResolved existed) re-qualified for a bailout
          // loan immediately, which is the opposite of what a cooldown is
          // for. An unknown default date is not evidence the cooldown has
          // elapsed; treat it as still in force.
          { status: 'DEFAULTED', turnResolved: null },
        ],
      },
      select: { id: true },
    })
    if (existingDebt) continue

    const allyIds = findAllyIds(factionTies(broke))
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
      // #441: skipDuplicates rather than catch-and-continue — see
      // wakeTick.ts's ActiveWake creation for the full reasoning. Short
      // version: this runs on the tick's shared transaction client, and a
      // raised constraint violation aborts the whole transaction, so the
      // `continue` this used to do carried on into a transaction that could
      // no longer execute anything. ON CONFLICT DO NOTHING never raises.
      const created = await ctx.db.factionDebt.createMany({
        data: [{
          campaignId: ctx.campaignId,
          creditorFactionId: lender.id,
          debtorFactionId: broke.id,
          amount: decision.amount,
          turnCreated: ctx.turnNumber,
        }],
        skipDuplicates: true,
      })
      if (created.count === 0) continue
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
