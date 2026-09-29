// src/lib/__tests__/prismaPooling.test.ts
//
// #500 and #488, both of which are one-line configuration facts that had
// no test and therefore no way to stay true.
//
// Pooling (#500): each concurrent serverless invocation opens its own
// Postgres connection, so the fan-out of a cron sweep or a burst of
// players can exhaust max_connections while nearly all of those
// connections sit idle. It does not degrade gradually and it does not look
// like load — it is "too many clients already", arriving at exactly the
// traffic worth having. The warning has to be sayable BEFORE that, because
// afterwards it reads as a database outage rather than as configuration.
//
// Logging (#488): `log: ['query']` emits every statement with its bound
// values, which in production meant emails, reset tokens and whole scenes
// of prose streaming into the log drain.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ORIGINAL_ENV = { ...process.env }
let warn: ReturnType<typeof vi.spyOn>

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor(public options: any) {}
  },
}))

beforeEach(() => {
  vi.resetModules()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  // The module memoises onto globalThis in development; clear it so each
  // case constructs its own client.
  delete (global as any).prisma
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  warn.mockRestore()
})

async function load(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete (process.env as any)[k]
    else (process.env as any)[k] = v
  }
  return import('../prisma')
}

describe('query logging (#488)', () => {
  it('is off in production, where bound values are the payload', async () => {
    const { prisma } = await load({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x-pooler/db' })
    expect((prisma as any).options.log).toEqual(['error', 'warn'])
  })

  it('stays on in development, which is what it is for', async () => {
    const { prisma } = await load({ NODE_ENV: 'development', DATABASE_URL: 'postgres://localhost/db' })
    expect((prisma as any).options.log).toContain('query')
  })

  it('keeps errors and warnings everywhere — those carry no parameters', async () => {
    const { prisma } = await load({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x-pooler/db' })
    expect((prisma as any).options.log).toContain('error')
    expect((prisma as any).options.log).toContain('warn')
  })
})

describe('connection pooling (#500)', () => {
  it('warns when production runs against an unpooled URL', async () => {
    await load({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@ep-plain.neon.tech/db' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unpooled'))
  })

  it('stays quiet for a Neon pooler host', async () => {
    await load({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@ep-x-pooler.neon.tech/db' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('stays quiet for an explicit pgbouncer=true', async () => {
    await load({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@host/db?pgbouncer=true' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('never warns in development, where unpooled is correct', async () => {
    await load({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://localhost:5432/db' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not warn when there is no URL at all', async () => {
    // A different and louder failure, which Prisma itself reports.
    await load({ NODE_ENV: 'production', DATABASE_URL: undefined })
    expect(warn).not.toHaveBeenCalled()
  })
})
