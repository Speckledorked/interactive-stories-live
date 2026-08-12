// src/lib/game/stateMutation.ts
// Persisted audit trail for individual, field-level AI-proposed state
// changes — the tier below AIValidationFailure (game/ai/validation.ts),
// which only ever records the AI's WHOLE response failing Zod schema
// validation. A structurally valid response can still have individual
// changes rejected or altered once it reaches business-rule validation
// (entity resolution, range clamping, ...) — today that's a console.warn
// only, gone the moment the log scrolls. recordStateMutation is the
// persisted, queryable version of that same moment.
//
// Written through the same transaction client (Prisma.TransactionClient)
// the caller is already using, so a StateMutation row and the write it
// describes (or the fact that nothing was written, for a REJECTED result)
// commit or roll back together — never diverging from what actually
// happened, unlike a fire-and-forget side write.

import { Prisma } from '@prisma/client'

type Db = Prisma.TransactionClient

export interface RecordStateMutationInput {
  campaignId: string
  sceneId?: string | null
  field: string
  previousValue?: unknown
  proposedValue?: unknown
  result: 'ACCEPTED' | 'REJECTED' | 'REPAIRED'
  repairedValue?: unknown
  reason?: string | null
}

/**
 * Best-effort by design, same as every other audit-trail write in this
 * codebase (AIValidationFailure, LoreCitation): a mutation record failing
 * to write must never take down the state change (or rejection) it's
 * describing. Callers should not await-and-fail on this.
 */
export async function recordStateMutation(db: Db, input: RecordStateMutationInput): Promise<void> {
  try {
    await db.stateMutation.create({
      data: {
        campaignId: input.campaignId,
        sceneId: input.sceneId ?? null,
        field: input.field,
        previousValue: input.previousValue as Prisma.InputJsonValue,
        proposedValue: input.proposedValue as Prisma.InputJsonValue,
        result: input.result,
        repairedValue: input.repairedValue as Prisma.InputJsonValue,
        reason: input.reason ?? null,
      },
    })
  } catch (error) {
    console.error('Failed to record state mutation:', error)
  }
}
