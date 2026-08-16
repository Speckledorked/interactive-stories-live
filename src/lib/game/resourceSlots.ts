// src/lib/game/resourceSlots.ts
// #378: what a location actually produces.
//
// Location.resourceSlots is the input to the entire logistics/supply/
// extraction subsystem — logisticsTick's extraction pass and its
// supply-route creation pass both open with `if
// (location.resourceSlots.length === 0) continue`. It had ZERO writers
// anywhere in the repository: the schema default, the migration default,
// two reads in logisticsTick, and test fixtures that hand-construct the
// array. So both gates skipped 100% of rows in every real campaign, on
// every tick, forever.
//
// Nothing was wrong with logisticsTick. The subsystem was built read-first
// — the tick logic, the SupplyRoute model, the war-blockade interaction and
// the tests all exist — and no authoring surface was ever added: not at
// campaign creation, not in the admin routes, not in the templates, and
// not as a backfill. There was no defect to fix, only an input that did
// not exist.
//
// This derives slots from what the world already says about a place, so
// existing campaigns and template-generated ones both get real logistics
// without anyone having to author a second field by hand. An explicit
// authoring surface can layer on top later; deriving is what makes the
// feature real TODAY, which is the difference between a scored subsystem
// and a dead one.

/**
 * The closed vocabulary. Deliberately small and generic: these are inputs
 * to a resource-flow simulation, not an economy of tradeable goods, and
 * logisticsTick only ever counts them (RESOURCE_GAIN_PER_SLOT × length).
 * A longer list would imply a granularity nothing downstream reads.
 */
export const RESOURCE_SLOT_KINDS = ['ore', 'grain', 'timber', 'trade', 'lore'] as const
export type ResourceSlotKind = (typeof RESOURCE_SLOT_KINDS)[number]

/**
 * locationType is free text — the AI world generator writes it, the wiki
 * renders it, and nothing constrains it to a vocabulary. So this matches on
 * substrings rather than equality, and a location whose type says nothing
 * recognisable falls through to the settlement default below rather than
 * producing nothing.
 */
const TYPE_HINTS: Array<{ match: RegExp; slots: ResourceSlotKind[] }> = [
  { match: /mine|quarry|forge|foundry|smelt/i, slots: ['ore'] },
  { match: /farm|field|orchard|vineyard|granary|pasture/i, slots: ['grain'] },
  { match: /forest|wood|lumber|grove|timber/i, slots: ['timber'] },
  { match: /port|harbor|harbour|market|bazaar|caravan|trade|dock/i, slots: ['trade'] },
  { match: /librar|archive|academy|temple|monaster|scriptorium|college/i, slots: ['lore'] },
  { match: /city|capital/i, slots: ['trade', 'grain'] },
  { match: /town|village|settlement|hold|keep|fort|citadel/i, slots: ['grain'] },
  // A wilderness or a ruin genuinely produces nothing — an empty array
  // here is a real answer, not a missing one.
  { match: /ruin|wasteland|wilds|wilderness|badlands|swamp|desert|tomb|crypt/i, slots: [] },
]

/**
 * What this location yields.
 *
 * Pure and deterministic — no randomness — so the same world generates the
 * same economy every time, matching the tick's own determinism guarantee.
 *
 * A location with no recognisable type is treated as an ordinary
 * settlement producing 'grain'. That default is deliberate: the failure
 * mode this fixes is a world where NOTHING produces anything, and erring
 * toward a small real yield is far better than reproducing the empty case
 * for every location whose type the generator happened to phrase unusually.
 */
export function deriveResourceSlots(location: {
  name?: string | null
  locationType?: string | null
  description?: string | null
}): ResourceSlotKind[] {
  // Type is the strongest signal; name and description are fallbacks for
  // the (common) case where the generator described a place without
  // classifying it.
  const haystacks = [location.locationType, location.name, location.description]

  for (const haystack of haystacks) {
    if (!haystack) continue
    for (const hint of TYPE_HINTS) {
      if (hint.match.test(haystack)) return [...hint.slots]
    }
  }

  return ['grain']
}
