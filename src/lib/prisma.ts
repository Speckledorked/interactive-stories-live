// src/lib/prisma.ts
// This file creates a single Prisma client instance that we reuse throughout the app
// This prevents creating too many database connections

import { PrismaClient } from '@prisma/client'

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.
const globalForPrisma = global as unknown as { prisma: PrismaClient }

// Query logging is a development affordance and a production liability.
// `log: ['query']` emits every statement WITH ITS BOUND VALUES — so in
// production that meant email addresses, password-reset tokens and whole
// scenes of story prose streaming into the log drain on every request.
// Three costs at once: drain spend, per-query serialisation latency, and a
// copy of the data sitting somewhere with weaker access control than the
// database it came from.
//
// Errors and warnings stay on everywhere: those are the lines anyone
// actually reads during an incident, and they carry no bound parameters.
const logLevels: ('query' | 'error' | 'warn')[] =
  process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['query', 'error', 'warn']

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: logLevels,
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
