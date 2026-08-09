// src/lib/wikiCategoryGrouping.ts
//
// The wiki page rendered every tab as one long flat list — reported as
// "obnoxious to view on mobile and desktop with a giant long list" once a
// campaign had accumulated 19 clocks, 35 NPCs, etc. Every entry already
// carries tags[0] as its category (set by the sync writers in
// wikiSync.ts/sceneResolver.ts — faction archetype for factions, faction
// affiliation for NPCs, locationType for locations, status for quests,
// clock.category for clocks, item type for items), so grouping needs no
// new data, just a read-side fold. Pure so the grouping/ordering rules are
// testable without a rendered page.

export interface WikiEntryLike {
  tags?: string[] | null
}

export interface WikiCategoryGroup<T> {
  label: string
  entries: T[]
}

export const UNCATEGORIZED_LABEL = 'Uncategorized'

// Mirrors quests/page.tsx's own STATUS_GROUPS order — a quest's category
// tag IS its status (see sceneResolver.ts), so grouping should read the
// same way the dedicated Quests tab already does, not alphabetically
// (which would put "Abandoned" before "Active").
const QUEST_STATUS_ORDER = ['active', 'completed', 'failed', 'abandoned']

/**
 * "essence-magic" / "secret_society" -> "Essence magic" / "Secret society".
 * Most tags arrive already well-formed (faction archetypes are humanized
 * server-side, NPC affiliations are real names) — this only has real work
 * to do on the plain-lowercase ones (location type, quest status, clock
 * category).
 */
export function formatCategoryLabel(raw: string): string {
  const spaced = raw.replace(/[_-]+/g, ' ').trim()
  if (!spaced) return UNCATEGORIZED_LABEL
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Groups entries by their first tag, formats the label, and orders the
 * groups — quest status in the fixed order above, everything else
 * alphabetically with Uncategorized always last. Entries within a group
 * keep whatever order they arrived in (the caller's own sort, e.g. by
 * name, is preserved).
 */
export function groupWikiEntriesByCategory<T extends WikiEntryLike>(
  entries: T[],
  entryType: string
): WikiCategoryGroup<T>[] {
  const buckets = new Map<string, WikiCategoryGroup<T>>()

  for (const entry of entries) {
    const rawTag = entry.tags && entry.tags.length > 0 ? entry.tags[0] : null
    const key = rawTag ? rawTag.trim().toLowerCase() : ''
    const label = rawTag ? formatCategoryLabel(rawTag) : UNCATEGORIZED_LABEL
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { label, entries: [] }
      buckets.set(key, bucket)
    }
    bucket.entries.push(entry)
  }

  const groups = Array.from(buckets.values())

  if (entryType === 'QUEST') {
    groups.sort((a, b) => {
      const ai = QUEST_STATUS_ORDER.indexOf(a.label.toLowerCase())
      const bi = QUEST_STATUS_ORDER.indexOf(b.label.toLowerCase())
      if (ai !== -1 || bi !== -1) return (ai === -1 ? QUEST_STATUS_ORDER.length : ai) - (bi === -1 ? QUEST_STATUS_ORDER.length : bi)
      return a.label.localeCompare(b.label)
    })
    return groups
  }

  groups.sort((a, b) => {
    if (a.label === UNCATEGORIZED_LABEL) return 1
    if (b.label === UNCATEGORIZED_LABEL) return -1
    return a.label.localeCompare(b.label)
  })
  return groups
}
