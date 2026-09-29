// src/app/api/health/route.ts
//
// Liveness, for an external uptime monitor to poll (#492).
//
// The *-health routes next door are diagnostics and are platform-admin
// only (#509) — which is correct for them and makes them useless as an
// uptime target, since a monitor cannot sign in. This is the other thing:
// deliberately unauthenticated, deliberately boring, and deliberately
// saying nothing an attacker can use. No version, no secrets inventory,
// no environment, no counts.
//
// It touches the database, because "the process is up" is not the outage
// worth paging on — a deployment that serves 200s while every query fails
// looks perfectly healthy to a monitor that only checks the port. The
// query is the cheapest one Postgres can answer, so polling this every
// minute costs nothing.
//
// Point an uptime service (Better Stack, UptimeRobot, Pingdom — any of
// them) at this path and alert on a non-200. That is the half of #492 the
// repository cannot do for itself: reportError tells the operator when a
// request FAILED, and nothing can tell them when requests stopped arriving
// at all except something outside the deployment.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok' })
  } catch {
    // No error text: this endpoint is public, and a database error message
    // names hosts, roles and sometimes connection strings. The status code
    // is the whole signal a monitor needs; the detail belongs in the log
    // drain and the alert webhook, which reportError already covers.
    return NextResponse.json({ status: 'degraded' }, { status: 503 })
  }
}
