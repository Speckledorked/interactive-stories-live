// src/lib/db/campaignAccess.ts
// The campaign-membership lookup nearly every campaign-scoped route needs
// before doing anything else — "does this user belong to this campaign, and
// what's their role" — used to be hand-written at each of the ~90 call
// sites that needed it (`campaignMembership.findUnique`/`findFirst` on the
// `(userId, campaignId)` unique key), with two different query forms in use
// for no reason. Centralized here instead. See README's database-layer
// refactor entry for the audit that found this.
//
// Deliberately a thin, single-purpose wrapper: it returns exactly what
// `findUnique` already returned — the full `CampaignMembership` row, or
// `null` — with no bundled role check and no thrown error. Every call
// site's existing `if (!membership) ...` / `if (membership.role !== ...)`
// logic keeps working completely unchanged; only the query itself is
// shared now.
//
// Not for the handful of routes that filter by role *inside* the query
// (`where: { userId, campaignId, role: 'ADMIN' }`) — that's a different
// shape (it collapses "not a member" and "member but not admin" into the
// same `null`), so those stay as their own inline query rather than being
// forced through this one.

import { prisma } from '@/lib/prisma'
import type { CampaignMembership } from '@prisma/client'

export function getCampaignMembership(
  userId: string,
  campaignId: string
): Promise<CampaignMembership | null> {
  return prisma.campaignMembership.findUnique({
    where: { userId_campaignId: { userId, campaignId } },
  })
}
