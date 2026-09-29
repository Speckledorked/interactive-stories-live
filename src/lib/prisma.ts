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

/**
 * #500: say so, once, if production is talking to Postgres directly.
 *
 * Each concurrent serverless invocation opens its own connection, so the
 * fan-out of a cron sweep or a burst of players can exhaust
 * max_connections while nearly all of those connections sit idle. The
 * failure is not gradual and it does not look like load — it is "too many
 * clients already", arriving at exactly the traffic worth having.
 *
 * A warning rather than a refusal: an unpooled URL is wrong for production
 * and completely correct for local development, and a deployment that
 * boots is strictly better than one that refuses to. But it has to be
 * SAYABLE before the spike, because afterwards it reads as a database
 * outage rather than as configuration.
 *
 * Heuristic on purpose. There is no way to ask a connection string whether
 * something is pooling behind it; these are the markers the two supported
 * shapes actually carry (Neon's `-pooler` host, or an explicit
 * `pgbouncer=true`), and a false warning costs one log line.
 */
function warnIfUnpooledInProduction(): void {
  if (process.env.NODE_ENV !== 'production') return
  const url = process.env.DATABASE_URL
  if (!url) return
  if (url.includes('-pooler') || url.includes('pgbouncer=true')) return

  console.warn(
    '⚠️  DATABASE_URL looks unpooled (no `-pooler` host, no `pgbouncer=true`). ' +
    'Every concurrent invocation opens its own connection, so a traffic burst can ' +
    'exhaust max_connections. See .env.example under DATABASE_URL.'
  )
}

warnIfUnpooledInProduction()

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: logLevels,
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
