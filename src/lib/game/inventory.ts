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
  // Broad display categorization — surfaced by itemRegistry.ts's wiki
  // aggregation. Purely informational: nothing below keys off itemType
  // itself, only off armorValue/damageBonus/effect directly, so a
  // miscategorized item never breaks a mechanic, just a label.
  itemType?: 'weapon' | 'armor' | 'consumable' | 'quest' | 'currency' | 'misc'
  // Structured mechanical identity for weapons, symmetric to armorValue:
  // when set, the exact damage bonus (0-3) this item grants when equipped,
  // used in place of guessing one from the name string (see
  // resolveDamageBonus below).
  damageBonus?: number
  // A consumable's mechanical payoff when it's actually consumed (see
  // resolveConsumableHeal and its call site in stateUpdater.ts's
  // inventory_changes handling). 'heal' is the only kind currently
  // enforced by the engine — its amount is applied deterministically the
  // instant the item is used (items_remove, or a negative items_modify
  // delta), regardless of what the AI separately narrates. 'custom' is
  // deliberately NOT enforced: it lets an item carry flavor text for an
  // effect that doesn't fit 'heal' (a charm against one specific curse, a
  // key that opens one specific door) without implying the engine acts on
  // it — only `description` is ever shown. Don't add a new `kind` here
  // without also adding real enforcement for it; an inert kind is exactly
  // the "looks wired, isn't" problem this field exists to avoid.
  effect?: {
    kind: 'heal' | 'custom'
    amount?: number // required for 'heal'; ignored (and may be omitted) for 'custom'
    description: string
  }
}

/**
 * Character inventory structure. There used to be an optional `slots`
 * capacity field plus a matching `hasInventorySpace` check, but neither
 * was ever wired into the real write path (stateUpdater.ts's
 * inventory_changes handling added items unconditionally) or shown to
 * players past character creation — a capacity number that silently did
 * nothing. Removed rather than enforced: making it real would mean
 * inventing what "full" should even do (reject the pickup and contradict
 * the AI's narration? auto-drop something? surface a choice to the
 * player?), which is a product decision, not a wiring fix.
 */
export interface CharacterInventory {
  items: InventoryItem[]
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

/**
 * Derive a rough damage bonus (0-3) from a weapon name string, mirroring
 * getArmorReduction's keyword heuristic. Most ordinary weapons get no
 * bonus at all — this only rewards names that clearly signal something
 * exceptional, so a plain "sword" or "bow" behaves exactly as it did
 * before this field existed:
 *   0 – ordinary/unrecognised weapon
 *   1 – heavy or two-handed weapon (greatsword, warhammer, maul, ...)
 *   2 – masterwork, enchanted, or legendary craftsmanship
 */
export function getWeaponDamageBonus(weaponName: string | null | undefined): number {
  if (!weaponName) return 0
  const lower = weaponName.toLowerCase()

  // Explicit "(+X damage)" description pattern takes priority
  const explicit = lower.match(/\(\+?(\d+)\s*damage\)/)
  if (explicit) return Math.min(3, parseInt(explicit[1], 10))

  // Masterwork/magical/legendary craftsmanship
  if (/\b(legendary|artifact|masterwork|enchanted|magical?)\b/.test(lower)) return 2
  // Heavy or two-handed weapons
  if (/\b(greatsword|great[\s-]axe|warhammer|maul|zweihander|two[\s-]handed|heavy)\b/.test(lower)) return 1

  return 0
}

/**
 * Resolve the damage bonus a character's equipped weapon actually grants,
 * preferring a structured damageBonus on the matching inventory item over
 * guessing from the name string — same relationship resolveArmorValue has
 * to getArmorReduction.
 */
export function resolveDamageBonus(
  inv: CharacterInventory | null | undefined,
  weaponName: string | null | undefined
): number {
  if (!weaponName) return 0
  const item = inv?.items?.find(i => i.name.toLowerCase() === weaponName.toLowerCase())
  if (item && typeof item.damageBonus === 'number' && Number.isFinite(item.damageBonus)) {
    return Math.max(0, Math.min(3, item.damageBonus))
  }
  return getWeaponDamageBonus(weaponName)
}

/**
 * How much harm a consumable's 'heal' effect actually restores, scaled by
 * how many units were consumed at once (e.g. drinking 2 potions from a
 * stack in one action — see stateUpdater.ts's items_modify handling).
 * Returns 0 for anything that isn't a 'heal' effect, including 'custom',
 * which is deliberately flavor-only (see InventoryItem.effect's doc
 * comment) — this function is the one and only place 'heal' is enforced.
 */
export function resolveConsumableHeal(
  item: InventoryItem | null | undefined,
  unitsUsed: number = 1
): number {
  if (!item?.effect || item.effect.kind !== 'heal' || !item.effect.amount) return 0
  return Math.max(0, item.effect.amount) * Math.max(1, unitsUsed)
}
