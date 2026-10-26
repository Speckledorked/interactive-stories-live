// src/lib/game/archetypeLoadout.ts
//
// What picking an origin archetype fills in (#508).
//
// Origin archetype cards are per-universe presets generated at campaign
// creation (lib/ai/worldExtras.ts) and stored on CampaignArchetype. They
// carry suggested stats, starting gear and a tie — everything a playable
// character needs beyond a name.
//
// That mapping existed, inline in EnhancedCreateCharacterForm, and was
// therefore reachable only by someone who walked six tabs of a form. The
// quick-start path needs the identical mapping, and a mapping that must be
// identical in two places is not a component's business — the same
// argument consequenceLabels.ts makes for its own copy.
//
// Pure, and returns DELTAS rather than a merged character: the full form
// merges them over whatever the player has already typed, while
// quick-start merges them over its defaults. A function that did the
// merging would have to know which of those it was doing.
//
// Item ids are deliberately NOT assigned here. The form generates them
// with a timestamp and uses them as list keys for edit and remove; moving
// that inside a pure function would either make it impure or change the
// id scheme of a surface that already works. Callers add ids.

/** One card, as the world-extras route serves it. */
export interface ArchetypeCard {
  id: string
  name: string
  description: string
  originFamiliarity: 'NATIVE' | 'NEWCOMER' | 'OUTSIDER'
  suggestedStats: Record<string, number> | null
  startingGear: {
    weapon?: string
    armor?: string
    misc?: string
    items?: Array<{ name: string; quantity: number; tags: string[] }>
  } | null
  startingTie: { description?: string } | null
  backstoryPrompts: string[]
}

/** An item as the card describes it — no id yet. See the module doc. */
export interface LoadoutItem {
  name: string
  quantity: number
  tags: string[]
}

/**
 * The fields a card fills in. Each is null when the card says nothing
 * about it, so a caller can tell "this archetype carries no gear" from
 * "this archetype carries empty gear" and leave what the player typed
 * alone in the first case.
 */
export interface ArchetypeLoadout {
  originFamiliarity: 'NATIVE' | 'NEWCOMER' | 'OUTSIDER'
  stats: Record<string, number> | null
  /** Only the slots the card actually names, so a caller spreads it over
   *  its own values without blanking the ones it already had. */
  equipment: { weapon?: string; armor?: string; misc?: string } | null
  items: LoadoutItem[] | null
}

/**
 * Read a card's loadout.
 *
 * Deliberately total: every field of the result is derived, none is
 * guessed, and a card with nothing but a name and a description yields a
 * loadout of all nulls plus its familiarity. That is a legitimate card —
 * generation is allowed to fail at producing stats for one archetype
 * while succeeding for its siblings.
 */
export function archetypeLoadout(card: ArchetypeCard): ArchetypeLoadout {
  const gear = card.startingGear

  // Only the named slots. An archetype that specifies a weapon and no
  // armor must not blank the armor the player already chose, which is why
  // this is built up rather than spread wholesale.
  let equipment: ArchetypeLoadout['equipment'] = null
  if (gear) {
    const named: { weapon?: string; armor?: string; misc?: string } = {}
    if (gear.weapon) named.weapon = gear.weapon
    if (gear.armor) named.armor = gear.armor
    if (gear.misc) named.misc = gear.misc
    equipment = Object.keys(named).length > 0 ? named : null
  }

  return {
    originFamiliarity: card.originFamiliarity,
    stats: card.suggestedStats ?? null,
    equipment,
    // An explicit empty list is kept as null rather than as []: "this card
    // lists no items" should leave a caller's own items alone, and only a
    // card that names items should replace them.
    items: gear?.items && gear.items.length > 0 ? gear.items : null,
  }
}

/**
 * Whether a card carries enough to start playing without filling in a
 * form.
 *
 * Stats are the line. Everything else a character needs is either
 * generated server-side from archetypeId (capability glimpses, the
 * starting tie) or editable later by the player — but stats are not in
 * PLAYER_EDITABLE_FIELDS, so a character who starts without them cannot
 * be given them afterwards except by an admin. Offering one-step start
 * from a statless card would hand someone a character they are stuck
 * with.
 */
export function isQuickStartable(card: ArchetypeCard): boolean {
  return card.suggestedStats !== null && Object.keys(card.suggestedStats).length > 0
}
