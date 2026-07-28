// src/lib/game/integrity/applyRepairWrite.ts
// Turns a declarative RepairWrite into the actual Prisma call. Kept as its
// own tiny module (not inlined in runIntegrityPass) so the "what write does
// this repair mean" question has exactly one answer, shared by both the
// real applier and anything that wants to describe a repair without
// applying it (the dry-run report, and the Phase 1c audit).

import type { Prisma, PrismaClient } from '@prisma/client'
import { RepairWrite } from './types'

type Db = Prisma.TransactionClient | PrismaClient

export async function applyRepairWrite(db: Db, write: RepairWrite): Promise<void> {
  switch (write.model) {
    case 'clock':
      await db.clock.update({ where: { id: write.id }, data: write.data })
      return
    case 'character':
      await db.character.update({ where: { id: write.id }, data: write.data })
      return
    case 'nPC':
      await db.nPC.update({ where: { id: write.id }, data: write.data })
      return
    case 'faction':
      await db.faction.update({ where: { id: write.id }, data: write.data })
      return
    case 'debt':
      await db.debt.update({ where: { id: write.id }, data: write.data })
      return
    case 'war':
      await db.war.update({ where: { id: write.id }, data: write.data })
      return
  }
}
