// src/lib/prisma.ts
// This file creates a single Prisma client instance that we reuse throughout the app
// This prevents creating too many database connections

import { PrismaClient } from '@prisma/client'

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.
const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['query', 'error', 'warn'], // Helpful for debugging
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
