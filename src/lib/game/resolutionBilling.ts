// src/lib/game/resolutionBilling.ts
// Per-scene-resolution billing: who pays, how much, and enforcement.
// Called from exactly one place — enqueueSceneResolution() — so it
// applies uniformly no matter what triggers a resolution: the last
// participant's action auto-resolving a closed scene, an open scene
// resolving immediately after a single action, or an admin's manual
// "Resolve Now". Previously this only ran inside the admin manual-resolve
// route, which meant the normal, automatic way almost everyone actually
// plays — auto-resolve — never charged anyone.

import { prisma } from '@/lib/prisma'
import { checkBalance, deductFunds, formatCurrency } from '@/lib/payment/service'

// Per-player cost in cents based on how many people the resolution serves.
export function getSceneCostPerPlayer(playerCount: number): number {
  if (playerCount <= 1) return 25 // $0.25 solo
  if (playerCount <= 4) return 50 // $0.50 small group
  return 75 // $0.75 large group
}

export interface BillingResult {
  ok: boolean
  error?: string
  details?: string
  playerCount?: number
  costPerPlayer?: number
}

/**
 * Charge everyone who benefits from resolving this scene's current
 * exchange. Closed scenes (predefined participants) bill every
 * participant, matching the original manual-resolve behavior. Open
 * scenes have no participant list to bill against, so they bill the
 * distinct players who actually submitted an action this exchange —
 * there's no other definition of "who used this resolution." (The old
 * manual-resolve route silently charged nobody for open scenes, since it
 * only ever iterated `participants.userIds`, which is empty for them.)
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

  const participants = (scene.participants as any) || {}
  let payerIds: string[] = participants.userIds || []

  if (payerIds.length === 0) {
    const actions = await prisma.playerAction.findMany({
      where: { sceneId, exchangeNumber: scene.currentExchange ?? 0 },
      select: { userId: true },
    })
    payerIds = Array.from(new Set(actions.map(a => a.userId)))
  }

  if (payerIds.length === 0) {
    // No one to bill (shouldn't happen — resolution requires an action
    // to trigger it). Let it through rather than block on an impossible
    // charge.
    return { ok: true, playerCount: 0, costPerPlayer: 0 }
  }

  const costPerPlayer = getSceneCostPerPlayer(payerIds.length)

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

  for (const uid of payerIds) {
    await deductFunds(
      uid,
      costPerPlayer,
      `Scene #${scene.sceneNumber} resolution (${payerIds.length} player${payerIds.length !== 1 ? 's' : ''})`,
      { sceneId, campaignId }
    )
  }

  return { ok: true, playerCount: payerIds.length, costPerPlayer }
}
