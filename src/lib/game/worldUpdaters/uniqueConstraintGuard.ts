// src/lib/game/worldUpdaters/uniqueConstraintGuard.ts
// Phase 1b added real DB uniqueness for NPC/Faction/Quest names and
// Quest.objectiveKey. Every write path that creates one of these already
// checks for an existing match first (resolveEntityByNameOrId for NPCs/
// factions, an explicit findFirst in quests.ts, claimObjectiveKey's
// check-then-act), so the constraint should be a pure backstop that never
// actually fires — but "should never fire" is exactly the claim that was
// wrong twice already this session (the Phase 0 bugs). All three creators
// run inside stateUpdater.ts's single $transaction wrapping the whole
// scene's world_updates, so an uncaught unique-violation here wouldn't just
// fail one NPC — it would roll back every other domain's changes for that
// scene too. This is what keeps that from being a regression.

import { Prisma } from '@prisma/client'

export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
