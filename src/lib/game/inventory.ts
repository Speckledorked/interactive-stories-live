// src/lib/game/inventory.ts
// Character inventory, equipment, and resource management

/**
 * Inventory item structure
 */
export interface InventoryItem {
  id: string
  name: string
  quantity?: number
  tags?: string[]
  // Structured mechanical identity (depth-hardening #33 — see README):
  // when the AI reports a specific numeric armor value for an item, that's
  // used exactly instead of guessed from the name string (see
  // resolveArmorValue below). Absent/undefined falls back to the existing
  // keyword heuristic — an item with no structured value behaves exactly
  // as it did before this field existed.
  armorValue?: number
}

/**
 * Character inventory structure
 */
export interface CharacterInventory {
  items: InventoryItem[]
  slots?: number
}

/**
 * Add an item to character inventory
 * If item exists by ID, increment quantity
 * Otherwise, add new item
 */
export function addItemToInventory(
  inv: CharacterInventory | null | undefined,
  item: InventoryItem
): CharacterInventory {
  const inventory: CharacterInventory = inv || { items: [] }

  const existingItem = inventory.items.find(i => i.id === item.id)

  if (existingItem) {
    // Increment quantity
    existingItem.quantity = (existingItem.quantity || 1) + (item.quantity || 1)
  } else {
    // Add new item
    inventory.items.push({
      ...item,
      quantity: item.quantity || 1
    })
  }

  return inventory
}

/**
 * Remove an item from character inventory
 * Decrements quantity or removes entirely if quantity reaches 0
 */
export function removeItemFromInventory(
  inv: CharacterInventory | null | undefined,
  itemId: string,
  quantity: number = 1
): CharacterInventory {
  const inventory: CharacterInventory = inv || { items: [] }

  const itemIndex = inventory.items.findIndex(i => i.id === itemId)

  if (itemIndex === -1) {
    // Item not found, return unchanged
    return inventory
  }

  const item = inventory.items[itemIndex]
  const currentQty = item.quantity || 1

  if (currentQty <= quantity) {
    // Remove item entirely
    inventory.items.splice(itemIndex, 1)
  } else {
    // Decrement quantity
    item.quantity = currentQty - quantity
  }

  return inventory
}

/**
 * Find an item in inventory by ID
 */
export function findItem(
  inv: CharacterInventory | null | undefined,
  itemId: string
): InventoryItem | null {
  if (!inv || !inv.items) return null
  return inv.items.find(i => i.id === itemId) || null
}

/**
 * Check if inventory has space for more items
 * If slots is defined, check against that limit
 */
export function hasInventorySpace(
  inv: CharacterInventory | null | undefined,
  additionalItems: number = 1
): boolean {
  if (!inv || inv.slots === undefined) {
    // No slot limit defined, always has space
    return true
  }

  const currentItemCount = inv.items.length
  return currentItemCount + additionalItems <= inv.slots
}

/**
 * Derive a PbtA-style armor reduction value (0–3) from an armor name string.
 *
 * Checks for an explicit "(X armor)" pattern first, then falls back to
 * keyword matching:
 *   0 – no armor / unrecognised
 *   1 – light armor  (leather, padded, hide, gambeson, …)
 *   2 – medium armor (chain mail, scale, brigandine, breastplate, …)
 *   3 – heavy armor  (plate, splint, full plate, …)
 */
export function getArmorReduction(armorName: string | null | undefined): number {
  if (!armorName) return 0
  const lower = armorName.toLowerCase()

  // Explicit "(X armor)" description pattern takes priority
  const explicit = lower.match(/\((\d+)\s*armor\)/)
  if (explicit) return Math.min(3, parseInt(explicit[1], 10))

  // Heavy
  if (/\b(plate|full[\s-]plate|heavy|splint|banded|Gothic|field\s*plate)\b/.test(lower)) return 3
  // Medium
  if (/\b(chain|chainmail|chain[\s-]mail|ring[\s-]mail|scale|brigandine|breastplate|medium)\b/.test(lower)) return 2
  // Light
  if (/\b(leather|padded|hide|studded|light|gambeson|jack[\s-]of[\s-]plates)\b/.test(lower)) return 1
  // Bare keyword "armor" with no modifier → light by default
  if (/\barmor\b/.test(lower)) return 1

  return 0
}

/**
 * Resolve the armor reduction actually worn, preferring a structured
 * armorValue on the matching inventory item over guessing from the name
 * string. This is the real mechanical payoff of InventoryItem.armorValue
 * above: an item the AI (or a future admin/player item-editor) gave an
 * exact value to is honored exactly, clamped to the same 0–3 PbtA range
 * getArmorReduction uses; anything else — no matching item, or a matching
 * item with no armorValue set — falls back to the existing keyword
 * heuristic, so legacy/freeform armor strings behave exactly as before.
 */
export function resolveArmorValue(
  inv: CharacterInventory | null | undefined,
  armorName: string | null | undefined
): number {
  if (!armorName) return 0
  const item = inv?.items?.find(i => i.name.toLowerCase() === armorName.toLowerCase())
  if (item && typeof item.armorValue === 'number' && Number.isFinite(item.armorValue)) {
    return Math.max(0, Math.min(3, item.armorValue))
  }
  return getArmorReduction(armorName)
}
