// src/lib/game/worldUpdaters/worldMetaNotes.ts
// Domain applier for world_updates.notes_for_gm (former "8": store GM
// notes in WorldMeta). See README Known Bugs P1 (stateUpdater
// decomposition, #4/#41).

import { Prisma } from '@prisma/client'

type Db = Prisma.TransactionClient

const MAX_GM_NOTES_HISTORY = 20

export async function storeGmNotesForTurn(
  tx: Db,
  campaignId: string,
  currentTurnNumber: number,
  notesForGm: string
): Promise<void> {
  const worldMeta = await tx.worldMeta.findUnique({
    where: { campaignId }
  })

  if (!worldMeta) return

  const currentMeta = (worldMeta.otherMeta as any) || {}
  const gmNotes = currentMeta.gm_notes_history || []

  gmNotes.push({
    turn: currentTurnNumber,
    notes: notesForGm,
    timestamp: new Date().toISOString()
  })

  // Keep only last 20 notes to avoid bloat
  if (gmNotes.length > MAX_GM_NOTES_HISTORY) {
    gmNotes.shift()
  }

  await tx.worldMeta.update({
    where: { id: worldMeta.id },
    data: {
      otherMeta: {
        ...currentMeta,
        gm_notes_history: gmNotes
      }
    }
  })

  console.log('📝 Stored GM notes')
}
