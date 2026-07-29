// src/lib/game/worldUpdaters/__tests__/testPrismaErrors.ts
// Shared fixture for the Phase 1b defensive-handling tests — a real
// Prisma.PrismaClientKnownRequestError instance, not a plain object, since
// isUniqueConstraintViolation (uniqueConstraintGuard.ts) checks `instanceof`.

import { Prisma } from '@prisma/client'

export function uniqueConstraintError(constraintName: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on the fields: (${constraintName})`, {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target: [constraintName] },
  })
}
