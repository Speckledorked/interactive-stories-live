// src/lib/game/itemRegistry.ts
// Campaign-wide view over per-character inventory JSON blobs. There is no
// Item table — items live inside each Character.inventory (see
// inventory_changes in stateUpdater.ts) — so the wiki's ITEM tab is built
// by aggregating those blobs at sync time instead of keeping a parallel
// registry that could drift from what characters actually carry.

export interface CharacterInventoryForAggregation {
  name: string
  inventory: unknown // Character.inventory Json: { items: [{ id, name, quantity, tags }] }
}

export interface AggregatedItem {
  name: string
  totalQuantity: number
  holders: Array<{ characterName: string; quantity: number }>
  tags: string[]
  // First non-empty itemType seen across every carrier — purely a display
  // label (see InventoryItem.itemType's doc comment in inventory.ts), not
  // something this module reconciles if carriers disagree.
  itemType?: string
}

/**
 * Collapse every character's inventory into one entry per distinct item
 * name (case-insensitive; first-seen casing wins). Pure — no I/O — so the
 * wiki sync can call it and tests can hit the merge rules directly.
 */
export function aggregateInventoryItems(
  characters: CharacterInventoryForAggregation[]
): AggregatedItem[] {
  const byKey = new Map<string, AggregatedItem>()

  for (const character of characters) {
    const items = (character.inventory as any)?.items
    if (!Array.isArray(items)) continue

    for (const item of items) {
      if (!item?.name || typeof item.name !== 'string') continue
      const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1
      const key = item.name.trim().toLowerCase()
      if (!key) continue

      let entry = byKey.get(key)
      if (!entry) {
        entry = { name: item.name.trim(), totalQuantity: 0, holders: [], tags: [] }
        byKey.set(key, entry)
      }

      if (!entry.itemType && typeof item.itemType === 'string' && item.itemType) {
        entry.itemType = item.itemType
      }

      entry.totalQuantity += quantity
      const holder = entry.holders.find(h => h.characterName === character.name)
      if (holder) {
        holder.quantity += quantity
      } else {
        entry.holders.push({ characterName: character.name, quantity })
      }
      if (Array.isArray(item.tags)) {
        for (const tag of item.tags) {
          if (typeof tag === 'string' && tag && !entry.tags.includes(tag)) {
            entry.tags.push(tag)
          }
        }
      }
    }
  }

  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name))
}

/** Wiki-entry description for one aggregated item. */
export function describeAggregatedItem(item: AggregatedItem): string {
  const holderLine = item.holders
    .map(h => (h.quantity > 1 ? `${h.characterName} (x${h.quantity})` : h.characterName))
    .join(', ')
  const parts: string[] = []
  if (item.itemType) parts.push(`Type: ${item.itemType}`)
  parts.push(`Carried by: ${holderLine}`)
  if (item.tags.length > 0) parts.push(`Tags: ${item.tags.join(', ')}`)
  return parts.join('\n\n')
}
