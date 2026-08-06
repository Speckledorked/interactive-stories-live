// src/lib/db/characterAccess.ts
// The character-ownership check the dynamic-downtime routes were missing
// entirely (docs/ARCHITECTURE.md's Priority List flagged this after #135's
// API-route-coverage sweep): `characters/[id]/dynamic-downtime[/suggestions]`
// and `dynamic-downtime-events/[id]/respond` verified the caller was
// authenticated but never that they owned the character being acted on.
// Mirrors requireCampaignAdmin's `{ x } | { response }` shape from
// campaignAccess.ts, and campaigns/[id]/scene/route.ts's existing
// `character.userId !== user.userId` check (already used there and at
// scene/ask-gm/route.ts) — centralized here rather than re-derived a
// fourth time.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Character } from '@prisma/client'

export async function requireCharacterOwner(
  userId: string,
  characterId: string
): Promise<{ character: Character } | { response: NextResponse }> {
  const character = await prisma.character.findUnique({ where: { id: characterId } })
  if (!character || character.userId !== userId) {
    return {
      response: NextResponse.json({ error: 'Character not found or does not belong to you' }, { status: 403 }),
    }
  }
  return { character }
}

// Same check, one hop further out: a dynamic-downtime EVENT belongs to an
// ACTIVITY, which belongs to a CHARACTER. Resolves that chain itself rather
// than trusting a characterId the client could pass in.
export async function requireDowntimeEventOwner(
  userId: string,
  eventId: string
): Promise<{ character: Character } | { response: NextResponse }> {
  const event = await prisma.downtimeEvent.findUnique({
    where: { id: eventId },
    select: { activity: { select: { characterId: true } } },
  })
  if (!event) {
    return { response: NextResponse.json({ error: 'Event not found' }, { status: 404 }) }
  }
  return requireCharacterOwner(userId, event.activity.characterId)
}
