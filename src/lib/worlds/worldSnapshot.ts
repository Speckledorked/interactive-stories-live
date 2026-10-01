// src/lib/worlds/worldSnapshot.ts
//
// #490 — turning a live campaign into something someone else can start from.
//
// A snapshot is a world DEFINITION: factions, the capability scaffold, stat
// labels, the calendar, world rules, origin archetypes, the corruption and
// advancement tracks, the opening premise. It is explicitly NOT the
// campaign's play history. Scenes, characters, messages, rolls, whispers and
// notes are somebody's game rather than their setting; the chronicle share
// link already exists for reading those, and forking into a stranger's
// transcript is both the wrong feature and a privacy problem.
//
// The format is deliberately the SHAPE OF THE GENERATION OUTPUT
// (PreGeneratedWorld in game/campaignCreation.ts) rather than a tidier
// schema of its own. Two consequences, both wanted:
//
//   - A fork replays the ordinary creation path with the model calls
//     skipped. There is no second seeding implementation to drift from the
//     first, which is how the forked world ends up subtly unlike one made
//     the normal way.
//   - The expensive part of making a world is paid once, by whoever
//     published it. Every fork after that costs nothing and lands as fast
//     as the seeding transaction.
//
// Reading a snapshot back is defensive on purpose. A row written by an
// older version of this code, or by a campaign whose generated columns were
// always null, must produce a WORLD rather than a crash — every field is
// optional downstream for exactly the reasons the live generation path
// tolerates each of its own calls failing.

import type { Prisma } from '@prisma/client'
import type { PreGeneratedWorld } from '@/lib/game/campaignCreation'
import type { GeneratedCapability, GeneratedFront, GeneratedStatLabels } from '@/lib/ai/worldGenerator'
import type { GeneratedCalendar } from '@/lib/game/calendar'

/** What a published world stores. Versioned so a reader can refuse a future one. */
export interface WorldSnapshot {
  /** Bumped only for a change a previous reader could not handle. */
  version: 1
  worldSeed: string
  factions: SnapshotFaction[]
  capabilities: GeneratedCapability[]
  statLabels: GeneratedStatLabels | null
  fronts: GeneratedFront[]
  archetypes: unknown[]
  corruptionTheme: unknown | null
  advancementTrack: unknown | null
  calendar: GeneratedCalendar | null
  worldRules: unknown[]
  moveFlavor: unknown[]
  npcs: unknown[]
  locations: unknown[]
}

export interface SnapshotFaction {
  name: string
  description: string
  goals: string
  resources: number
  influence: number
  threatLevel: number
}

/** The campaign columns a snapshot is built from. */
export interface SnapshotSource {
  initialWorldSeed: string
  statLabels: Prisma.JsonValue | null
  corruptionTheme: Prisma.JsonValue | null
  advancementTrack: Prisma.JsonValue | null
  calendarConfig: Prisma.JsonValue | null
  worldRules: Prisma.JsonValue | null
}

/** The related rows a snapshot is built from. */
export interface SnapshotRelations {
  factions: SnapshotFaction[]
  capabilities: GeneratedCapability[]
  fronts: GeneratedFront[]
  archetypes: unknown[]
  moveFlavor: unknown[]
  npcs: unknown[]
  locations: unknown[]
}

/** Narrow an unknown JSON value to an array, or empty. */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * Pure. Builds the snapshot from already-loaded rows so the shape is
 * testable without a database, and so the route that loads them is the only
 * thing that has to know which tables they live in.
 */
export function buildWorldSnapshot(
  campaign: SnapshotSource,
  relations: SnapshotRelations
): WorldSnapshot {
  // `worldRules` is stored as `{ rules: [...] }` on the campaign but
  // generated as a bare list. Unwrapped here so the snapshot always holds
  // the list, and a reader never has to know which of the two it got.
  const storedRules = campaign.worldRules as { rules?: unknown[] } | null
  return {
    version: 1,
    worldSeed: campaign.initialWorldSeed || '',
    factions: relations.factions,
    capabilities: relations.capabilities,
    statLabels: (campaign.statLabels as GeneratedStatLabels | null) ?? null,
    fronts: relations.fronts,
    archetypes: relations.archetypes,
    corruptionTheme: campaign.corruptionTheme ?? null,
    advancementTrack: campaign.advancementTrack ?? null,
    calendar: (campaign.calendarConfig as GeneratedCalendar | null) ?? null,
    worldRules: asArray(storedRules?.rules),
    moveFlavor: relations.moveFlavor,
    npcs: relations.npcs,
    locations: relations.locations,
  }
}

/**
 * The one thing a snapshot must have to be worth publishing.
 *
 * A world with no factions and no capabilities is not a setting anyone can
 * start from — it is an empty campaign, and listing it in a directory wastes
 * the time of everyone who opens it. Checked at publish time so the refusal
 * reaches the person who can do something about it (play more, then
 * publish), rather than becoming a disappointing fork later.
 */
export function isPublishable(snapshot: WorldSnapshot): boolean {
  return snapshot.factions.length > 0 || snapshot.capabilities.length > 0
}

/**
 * Read a stored snapshot back into the bundle creation takes.
 *
 * Returns null for a snapshot this code cannot honour — a future `version`,
 * or a row that is not an object at all. Null means "do not fork this",
 * which the caller turns into a plain refusal; guessing at an unknown
 * version would seed a world from fields it had misread.
 */
export function snapshotToPreGenerated(stored: unknown): PreGeneratedWorld | null {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null
  const snapshot = stored as Partial<WorldSnapshot>
  if (snapshot.version !== 1) return null

  return {
    worldSeed: typeof snapshot.worldSeed === 'string' ? snapshot.worldSeed : '',
    factions: asArray(snapshot.factions) as PreGeneratedWorld['factions'],
    capabilities: asArray(snapshot.capabilities) as GeneratedCapability[],
    statLabels: (snapshot.statLabels as GeneratedStatLabels | undefined) ?? undefined,
    fronts: asArray(snapshot.fronts) as GeneratedFront[],
    // Reassembled into the shape the second generation stage returns, since
    // that is what creation reads. A fork with no archetypes gets the same
    // blank creation wizard a live generation failure produces — a known,
    // handled state rather than a new one.
    worldExtras: {
      archetypes: asArray(snapshot.archetypes),
      corruptionTheme: snapshot.corruptionTheme ?? null,
      advancementTrack: snapshot.advancementTrack ?? null,
      // A fork's track was not declined by a generator and did not fumble;
      // it is whatever the published world had. 'declined' is the outcome
      // that means "this universe has no ranks", which is the truthful
      // reading of a snapshot that carries no track.
      advancementTrackOutcome: snapshot.advancementTrack ? 'generated' : 'declined',
      npcs: asArray(snapshot.npcs),
      locations: asArray(snapshot.locations),
    } as PreGeneratedWorld['worldExtras'],
    moveFlavor: asArray(snapshot.moveFlavor) as PreGeneratedWorld['moveFlavor'],
    calendar: (snapshot.calendar as GeneratedCalendar | undefined) ?? null,
    worldRules: asArray(snapshot.worldRules) as PreGeneratedWorld['worldRules'],
  }
}

/** Reserved words a slug must not become, and the cap on its length. */
const SLUG_MAX = 60
const RESERVED_SLUGS = new Set(['new', 'edit', 'api', 'admin', 'fork', 'browse'])

/**
 * A URL-safe slug for a title, or null when the title has nothing usable in
 * it. Null rather than a generated fallback: the caller appends its own
 * uniquifying suffix, and a world whose whole slug is a random suffix is
 * worse to share than one the author is asked to retitle.
 */
export function slugifyTitle(title: string): string | null {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    // Strip combining marks so "Ásgard" slugs as "asgard" rather than
    // losing the letter entirely to the non-ASCII filter below.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '')

  if (!slug || RESERVED_SLUGS.has(slug)) return null
  return slug
}
