// src/lib/game/worldUpdaters/bargainOffers.ts
// Domain applier for world_updates.bargain_offers (former "7a-bis"):
// persists a corruption bargain so the character's NEXT action can
// mechanically invoke it (see resolution.ts surge). See README Known Bugs
// P1 (stateUpdater decomposition, #4/#41).

import { Prisma } from '@prisma/client'
import type { WorldUpdates } from '@/lib/ai/schema'
import { MAX_CORRUPTION, CorruptionTheme } from '../corruption'

type Db = Prisma.TransactionClient
export type BargainOffer = NonNullable<WorldUpdates['bargain_offers']>[number]

/**
 * Caller passes a memoized getter so the corruption-theme lookup — shared
 * with pc_changes' corruption_change handling — happens at most once per
 * batch, and only if actually needed.
 */
export async function applyBargainOffers(
  tx: Db,
  campaignId: string,
  currentTurnNumber: number,
  offers: BargainOffer[],
  getCorruptionTheme: () => Promise<CorruptionTheme | null>
): Promise<void> {
  const corruptionTheme = await getCorruptionTheme()
  if (!corruptionTheme) return

  for (const offer of offers) {
    if (!offer?.character_name_or_id || !offer?.offer) continue
    const character = await tx.character.findFirst({
      where: {
        campaignId,
        OR: [
          { id: offer.character_name_or_id },
          { name: { equals: offer.character_name_or_id, mode: 'insensitive' } }
        ]
      },
      select: { id: true, name: true, corruption: true }
    })
    // No offers to the already-consumed — there's nothing left to spend.
    if (!character || character.corruption >= MAX_CORRUPTION) continue
    await tx.character.update({
      where: { id: character.id },
      data: { pendingBargain: { offer: offer.offer, offeredTurn: currentTurnNumber } }
    })
    console.log(`😈 Bargain offered to ${character.name}: ${offer.offer}`)
  }
}
