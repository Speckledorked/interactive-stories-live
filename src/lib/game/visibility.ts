// src/lib/game/visibility.ts
// Fog of war — strip GM-only fields from API responses for non-admin campaign
// members. NPC, Faction, Location, and Clock all have a `gmNotes` field, and
// until now nothing stripped it before the JSON response reached the client:
// any campaign member (player, not just admin) could read the GM's private
// notes on any entity straight out of the network response, regardless of
// whether the frontend chose to render it.

export function redactGmNotes<T extends { gmNotes?: string | null }>(item: T, isAdmin: boolean): T {
  if (isAdmin) return item
  return { ...item, gmNotes: null }
}

export function redactGmNotesList<T extends { gmNotes?: string | null }>(items: T[], isAdmin: boolean): T[] {
  if (isAdmin) return items
  return items.map((item) => redactGmNotes(item, isAdmin))
}
