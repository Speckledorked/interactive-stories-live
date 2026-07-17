// src/lib/game/resolutionBilling.ts
// Per-scene billing: who pays, how much, and enforcement. Called from
// exactly two places in end-scene/route.ts — a preflight check before the
// scene's final AI resolution call, and the real metered charge after it —
// so a scene is billed once, covering however many mid-scene exchanges
// (each action's AI narration + classification) happened along the way,
// split across whoever took part in it.
//
// This charges the REAL, per-call AI cost recorded in AICostEntry (see
// cost-tracker.ts), not a flat guess: the flat $0.25/$0.50/$0.75 table this
// replaced was disconnected from actual spend and could over- or
// under-charge by a wide margin depending on scene length and model mix.

import { prisma } from '@/lib/prisma'
import { checkBalance, deductFunds, formatCurrency } from '@/lib/payment/service'

// Real AI cost is a few cents at most per scene (see cost-tracker.ts's
// pricing table) — this multiplier is what actually funds hosting, dev
// time, and Stripe's own cut on top of the raw token cost.
const MARGIN_MULTIPLIER = 6

// Whole-cent floor so a cheap scene never rounds down to a free one.
const MIN_CHARGE_CENTS = 5

// The preflight check runs before the scene's FINAL resolution call, whose
// cost isn't recorded yet — this is a conservative overestimate of what one
// more flagship-model call plausibly costs (with margin), so we don't let a
// scene attempt a call its participants can't cover.
const PREFLIGHT_BUFFER_CENTS = 20

export interface BillingResult {
  ok: boolean
  error?: string
  details?: string
  playerCount?: number
  costPerPlayer?: number
}

/** Pure: raw metered cost (in cents) -> what's actually charged. */
export function meteredChargeCents(rawCostCents: number): number {
  return Math.max(MIN_CHARGE_CENTS, Math.ceil(rawCostCents * MARGIN_MULTIPLIER))
}

async function sumSceneAICostCents(sceneId: string): Promise<number> {
  const result = await prisma.aICostEntry.aggregate({
    where: { sceneId },
    _sum: { costMicros: true },
  })
  return (result._sum.costMicros || 0) / 10_000 // micros -> cents
}

async function resolvePayerIds(
  sceneId: string,
  scene: { currentExchange: number | null; participants: unknown }
): Promise<string[]> {
  const participants = (scene.participants as any) || {}
  let payerIds: string[] = participants.userIds || []

  if (payerIds.length === 0) {
    const actions = await prisma.playerAction.findMany({
      where: { sceneId, exchangeNumber: scene.currentExchange ?? 0 },
      select: { userId: true },
    })
    payerIds = Array.from(new Set(actions.map(a => a.userId)))
  }

  return payerIds
}

async function checkPayersCanAfford(
  payerIds: string[],
  costPerPlayer: number
): Promise<BillingResult> {
  const payerUsers = await prisma.user.findMany({
    where: { id: { in: payerIds } },
    select: { id: true, name: true, email: true },
  })

  const balanceChecks = await Promise.all(
    payerIds.map(async uid => {
      const check = await checkBalance(uid, costPerPlayer)
      const userInfo = payerUsers.find(u => u.id === uid)
      return { ...check, uid, displayName: userInfo?.name || userInfo?.email || uid }
    })
  )

  const skint = balanceChecks.filter(b => !b.sufficient)
  if (skint.length > 0) {
    const names = skint
      .map(b => `${b.displayName} (has ${formatCurrency(b.currentBalance)}, needs ${formatCurrency(costPerPlayer)})`)
      .join(', ')
    return {
      ok: false,
      error: 'Insufficient balance',
      details: `Cannot resolve: ${names}. Ask them to add funds before retrying.`,
    }
  }

  return { ok: true }
}

/**
 * Run BEFORE the scene's final resolution call. The exact cost of that
 * call isn't known yet, so this checks against what's accrued so far this
 * scene plus a conservative buffer — good enough to block an obviously
 * unaffordable attempt before spending on it, without blocking on a number
 * that's still an estimate.
 */
export async function preflightSceneBilling(sceneId: string): Promise<BillingResult> {
  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    select: { currentExchange: true, participants: true },
  })
  if (!scene) return { ok: true, playerCount: 0 }

  const payerIds = await resolvePayerIds(sceneId, scene)
  if (payerIds.length === 0) return { ok: true, playerCount: 0 }

  const costSoFarCents = await sumSceneAICostCents(sceneId)
  const estimatedTotalCents = meteredChargeCents(costSoFarCents) + PREFLIGHT_BUFFER_CENTS
  const costPerPlayer = Math.ceil(estimatedTotalCents / payerIds.length)

  const affordability = await checkPayersCanAfford(payerIds, costPerPlayer)
  if (!affordability.ok) return affordability
  return { ok: true, playerCount: payerIds.length, costPerPlayer }
}

/**
 * Run AFTER the scene's resolution (and any world turn) has completed, so
 * every AI call this scene made — across however many exchanges it took —
 * has a recorded AICostEntry. Charges the real total, split across
 * whoever took part, regardless of whether resolution ultimately
 * succeeded: the AI spend already happened either way.
 */
export async function chargeForSceneResolution(
  campaignId: string,
  sceneId: string
): Promise<BillingResult> {
  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    select: { sceneNumber: true, currentExchange: true, participants: true },
  })
  if (!scene) {
    return { ok: false, error: 'Scene not found' }
  }

  const payerIds = await resolvePayerIds(sceneId, scene)
  if (payerIds.length === 0) {
    // No one to bill (shouldn't happen — resolution requires an action to
    // trigger it). Let it through rather than block on an impossible charge.
    return { ok: true, playerCount: 0, costPerPlayer: 0 }
  }

  const rawCostCents = await sumSceneAICostCents(sceneId)
  const totalChargeCents = meteredChargeCents(rawCostCents)
  const costPerPlayer = Math.ceil(totalChargeCents / payerIds.length)

  const affordability = await checkPayersCanAfford(payerIds, costPerPlayer)
  if (!affordability.ok) return affordability

  for (const uid of payerIds) {
    await deductFunds(
      uid,
      costPerPlayer,
      `Scene #${scene.sceneNumber} resolution (${payerIds.length} player${payerIds.length !== 1 ? 's' : ''}, metered AI cost $${(rawCostCents / 100).toFixed(4)})`,
      { sceneId, campaignId, rawCostCents }
    )
  }

  return { ok: true, playerCount: payerIds.length, costPerPlayer }
}
