import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'
import { visibleTo } from '@/lib/api/visibility'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { summarizeNpcRelationship, type NpcRelationshipValues } from '@/lib/game/npcRelationship'

// Fog of war: WikiEntry rows are matched to their source entity by name, not
// a real FK, so there's no isDiscovered column to filter on directly here.
// Cross-reference against the currently-visible NPC/Faction/Location/Clock
// names instead (isDiscovered for the first three, isHidden for clocks).
// ITEM/QUEST/LORE/CUSTOM have no corresponding visibility flag and pass
// through untouched. This is defense in depth on top of the write-side
// gating in sceneResolver.ts/wikiSync.ts, covering the case where an entity
// got a wiki entry while visible and was later re-hidden.

// The reverse direction matters too: entities that exist and are visible but
// have never been WRITTEN about (wiki sync only fires when a scene resolution
// touches an entity, so world-generation factions/locations start entry-less).
// The campaign overview counts those live entities and links here, so without
// stubs the wiki says "2 factions" and shows none. visibleEntityStubs()
// synthesizes read-only entries for them, using the same admin-aware
// visibility filters as the campaign GET so the counts line up exactly.
async function filterDiscoveredEntries<T extends { entryType: string; name: string }>(
  campaignId: string,
  entries: T[]
): Promise<T[]> {
  const [discoveredNpcs, discoveredFactions, discoveredLocations, visibleClocks] = await Promise.all([
    // Deliberately player-scoped even for an admin: this index decides
    // which names inside wiki PROSE become links, and a link to something
    // undiscovered would reveal it exists. Passing a non-admin role here is
    // the point, not an oversight.
    prisma.nPC.findMany({ where: { campaignId, ...visibleTo('npc', null) }, select: { name: true } }),
    prisma.faction.findMany({ where: { campaignId, ...visibleTo('faction', null) }, select: { name: true } }),
    prisma.location.findMany({ where: { campaignId, ...visibleTo('location', null) }, select: { name: true } }),
    prisma.clock.findMany({ where: { campaignId, ...visibleTo('clock', null) }, select: { name: true } }),
  ])

  const npcNames = new Set(discoveredNpcs.map((n) => n.name))
  const factionNames = new Set(discoveredFactions.map((f) => f.name))
  const locationNames = new Set(discoveredLocations.map((l) => l.name))
  const clockNames = new Set(visibleClocks.map((c) => c.name))

  return entries.filter((entry) => {
    if (entry.entryType === 'NPC') return npcNames.has(entry.name)
    if (entry.entryType === 'FACTION') return factionNames.has(entry.name)
    if (entry.entryType === 'LOCATION') return locationNames.has(entry.name)
    if (entry.entryType === 'CLOCK') return clockNames.has(entry.name)
    return true
  })
}

const ENTITY_STUB_FIELDS = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} as const

function toStubEntry(
  campaignId: string,
  entryType: string,
  row: { id: string; name: string; description: string | null; createdAt: Date; updatedAt: Date }
) {
  const summary =
    row.description && row.description.length > 200
      ? row.description.slice(0, 197) + '…'
      : row.description || 'Known to exist — the chronicle has nothing on record yet.'
  return {
    id: `${entryType.toLowerCase()}-stub-${row.id}`,
    campaignId,
    entryType,
    name: row.name,
    summary,
    description: row.description || 'Nothing recorded yet. Entries fill in as the story touches them.',
    tags: [] as string[],
    aliases: [] as string[],
    imageUrl: null,
    importance: 'normal',
    lastSeenTurn: null,
    changelog: [] as unknown[],
    relatedEntries: [] as unknown[],
    createdBy: 'world',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Read-only stub entries for visible entities no scene has written about
 * yet. Visibility filters intentionally mirror the campaign GET
 * (api/campaigns/[id]/route.ts) — that's where the overview counts that
 * link here come from. gmNotes never enters the stub (only name +
 * description are selected).
 */
async function visibleEntityStubs(
  campaignId: string,
  isAdmin: boolean,
  requestedType: string | null,
  existingEntries: Array<{ entryType: string; name: string }>
) {
  const wanted = (type: string) => !requestedType || requestedType === type
  // #94: one gate, four models, and the clock's inverted polarity handled
  // by the helper rather than by a second ternary here.
  const role = isAdmin ? 'ADMIN' : 'PLAYER'

  const [npcs, factions, locations, clocks] = await Promise.all([
    wanted('NPC')
      ? prisma.nPC.findMany({ where: { campaignId, ...visibleTo('npc', role) }, select: ENTITY_STUB_FIELDS })
      : [],
    wanted('FACTION')
      ? prisma.faction.findMany({ where: { campaignId, ...visibleTo('faction', role) }, select: ENTITY_STUB_FIELDS })
      : [],
    wanted('LOCATION')
      ? prisma.location.findMany({ where: { campaignId, ...visibleTo('location', role) }, select: ENTITY_STUB_FIELDS })
      : [],
    wanted('CLOCK')
      ? prisma.clock.findMany({
          where: { campaignId, ...visibleTo('clock', role) },
          select: ENTITY_STUB_FIELDS,
        })
      : [],
  ])

  const covered = new Set(existingEntries.map((e) => `${e.entryType}:${e.name.toLowerCase()}`))
  const stubs = [
    ...npcs.map((r) => toStubEntry(campaignId, 'NPC', r)),
    ...factions.map((r) => toStubEntry(campaignId, 'FACTION', r)),
    ...locations.map((r) => toStubEntry(campaignId, 'LOCATION', r)),
    ...clocks.map((r) => toStubEntry(campaignId, 'CLOCK', r)),
  ].filter((s) => !covered.has(`${s.entryType}:${s.name.toLowerCase()}`))
  stubs.sort((a, b) => a.name.localeCompare(b.name))
  return stubs
}

/**
 * Attaches `myStanding: string[]` to every NPC-type entry — diegetic labels
 * (never numbers) drawn from the REQUESTING USER's own character, not a
 * shared campaign-wide value. This is what makes the wiki's NPC page
 * genuinely per-viewer: two different players looking at the same NPC can
 * see different labels, because each reads their own Character.relationships
 * blob (see worldUpdaters/characters.ts's relationship_changes handling).
 *
 * WikiEntry rows (and the synthetic stubs above) are matched to their real
 * NPC row by name, same as the fog-of-war filter above — there's no FK to
 * follow directly. Safe since Phase 1b added real case-insensitive
 * uniqueness on (campaignId, name) for NPCs.
 *
 * No-ops entirely (zero extra queries) when the requested type excludes
 * NPCs, and degrades to an empty array per entry when the user has no
 * character in this campaign yet.
 */
async function attachMyNpcStanding<T extends { entryType: string; name: string }>(
  campaignId: string,
  userId: string,
  entries: T[]
): Promise<Array<T & { myStanding?: string[] }>> {
  if (!entries.some((e) => e.entryType === 'NPC')) return entries

  const [npcs, myCharacter] = await Promise.all([
    prisma.nPC.findMany({ where: { campaignId }, select: { id: true, name: true } }),
    prisma.character.findFirst({
      where: { campaignId, userId, isAlive: true },
      select: { relationships: true },
    }),
  ])

  const npcIdByName = new Map(npcs.map((n) => [n.name.toLowerCase(), n.id]))
  const relationships = (myCharacter?.relationships as Record<string, NpcRelationshipValues> | null) || {}

  return entries.map((entry) => {
    if (entry.entryType !== 'NPC') return entry
    const npcId = npcIdByName.get(entry.name.toLowerCase())
    const myStanding = npcId ? summarizeNpcRelationship(relationships[npcId]) : []
    return { ...entry, myStanding }
  })
}

// GET /api/campaigns/[id]/wiki - Get wiki entries
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Called-out fix, not a silent behavior change: see quests/route.ts's
    // comment — hand-rolled token parsing here bypassed session revocation.
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const { searchParams } = new URL(request.url)
    const entryType = searchParams.get('type')

    // Verify user is a member of the campaign
    const membership = await getCampaignMembership(user.userId, campaignId)

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const whereClause: any = { campaignId }
    if (entryType) {
      whereClause.entryType = entryType
    }

    const entries = await prisma.wikiEntry.findMany({
      where: whereClause,
      orderBy: [
        { importance: 'desc' },
        { name: 'asc' }
      ]
    })

    // Fog of war: WikiEntry rows are matched to their source NPC/Faction/
    // Location by name, not a real FK, so isDiscovered can't be enforced by
    // the query above — cross-reference here instead. This is defense in
    // depth on top of the write-side gating (sceneResolver.ts, wikiSync.ts)
    // for the case where an entity was discovered, got a wiki entry, and
    // was then manually re-hidden via the admin panel. Admins see everything.
    const isAdmin = membership.role === UserRole.ADMIN
    const visibleEntries = isAdmin ? entries : await filterDiscoveredEntries(campaignId, entries)

    // Entities the fiction knows about but the wiki hasn't written up yet
    // still deserve a row — see visibleEntityStubs above.
    const stubs = await visibleEntityStubs(campaignId, isAdmin, entryType, visibleEntries)

    // Attach the requesting user's own per-character NPC standing — must
    // run after fog-of-war filtering above, so an undiscovered NPC's name
    // never gets a chance to match an entry the user shouldn't see exists.
    const combined = await attachMyNpcStanding(campaignId, user.userId, [...visibleEntries, ...stubs])

    return NextResponse.json({ entries: combined })
  } catch (error) {
    console.error('Error fetching wiki entries:', error)
    return NextResponse.json({ error: 'Failed to fetch wiki entries' }, { status: 500 })
  }
}

// POST /api/campaigns/[id]/wiki - Create a wiki entry
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Called-out fix, not a silent behavior change: see quests/route.ts's
    // comment — hand-rolled token parsing here bypassed session revocation.
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id

    // Verify user is admin of the campaign (only admins/AI can create entries)
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        campaignId,
        userId: user.userId,
        role: 'ADMIN'
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Only campaign admins can create wiki entries' }, { status: 403 })
    }

    const body = await request.json()
    const {
      entryType,
      name,
      summary,
      description,
      tags,
      aliases,
      imageUrl,
      importance,
      lastSeenTurn
    } = body

    const entry = await prisma.wikiEntry.create({
      data: {
        campaignId,
        entryType,
        name,
        summary,
        description,
        tags: tags || [],
        aliases: aliases || [],
        imageUrl,
        importance: importance || 'normal',
        lastSeenTurn,
        createdBy: 'ai'
      }
    })

    return NextResponse.json({ entry }, { status: 201 })
  } catch (error) {
    console.error('Error creating wiki entry:', error)
    return NextResponse.json({ error: 'Failed to create wiki entry' }, { status: 500 })
  }
}
