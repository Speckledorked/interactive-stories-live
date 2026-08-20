// src/lib/game/advancementTrack.ts
//
// What "getting stronger" MEANS in this universe, as structure the sheet can
// render instead of prose the player has to re-read.
//
// ## Why this exists
//
// A player learned in the fiction that essences exist and that ranks go
// unranked -> iron -> bronze, and the sheet could say nothing about either.
// Known facts updated (they are free text), but there was no "0/4 essences",
// no position on a rank ladder — because no structure existed to render. The
// only thing resembling progression was CampaignCapability rows, which are a
// flat list with a `domain` string.
//
// ## Why it is generated per universe and not hard-coded
//
// Essences and ranks are one setting's vocabulary. This engine already
// renames the five stats per universe (Campaign.statLabels), themes its
// corruption track per universe (corruptionTheme), and generates its calendar
// (calendarConfig) — hard-coding one fiction's progression would contradict
// all three and get unpicked the first time a campaign runs a different world.
//
// So this follows that pattern exactly, including its most important property:
// NULL IS A REAL ANSWER. A universe with no ranks and no slots gets null and
// the sheet renders nothing, the same way corruptionTheme null disables the
// corruption track entirely rather than inventing one.
//
// And it follows worldRules' discipline about what the model is allowed to
// decide: the SHAPE is closed and defined here. The generator picks names,
// order and capacities — never a new kind of progression, never a rule.

/** One rung on the ladder. Order in the array IS the progression order. */
export interface AdvancementTier {
  key: string
  label: string
  description?: string
}

/**
 * A bounded collection the character fills — essence slots, spell schools,
 * covenant marks. Filled by counting CampaignCapability rows whose `domain`
 * matches, so this renders from state that already exists rather than
 * introducing a second place progress is recorded.
 */
export interface AdvancementSlotGroup {
  key: string
  label: string
  capacity: number
  /** CampaignCapability.domain whose rows fill this group. */
  domain: string
}

export interface AdvancementTrack {
  tiers: AdvancementTier[]
  slotGroups: AdvancementSlotGroup[]
}

const MAX_TIERS = 12
const MAX_SLOT_GROUPS = 4
const MAX_CAPACITY = 20

function cleanString(value: unknown, max = 60): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

/**
 * Validate a stored or generated track.
 *
 * Returns null rather than a partial structure whenever what came back cannot
 * be rendered honestly — an unranked ladder with no rungs, a slot group with
 * no capacity. A half-track would put a progress bar on screen that means
 * nothing, which is worse than the prose it replaced.
 */
export function parseAdvancementTrack(raw: unknown): AdvancementTrack | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as { tiers?: unknown; slotGroups?: unknown; slot_groups?: unknown }

  const tiers: AdvancementTier[] = []
  const seenTierKeys = new Set<string>()
  if (Array.isArray(source.tiers)) {
    for (const entry of source.tiers) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      const key = cleanString(e.key, 40)
      const label = cleanString(e.label, 40)
      if (!key || !label || seenTierKeys.has(key.toLowerCase())) continue
      seenTierKeys.add(key.toLowerCase())
      const description = cleanString(e.description, 200)
      tiers.push({ key, label, ...(description ? { description } : {}) })
      if (tiers.length >= MAX_TIERS) break
    }
  }

  const rawGroups = Array.isArray(source.slotGroups)
    ? source.slotGroups
    : Array.isArray(source.slot_groups)
      ? source.slot_groups
      : []
  const slotGroups: AdvancementSlotGroup[] = []
  const seenGroupKeys = new Set<string>()
  for (const entry of rawGroups) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const key = cleanString(e.key, 40)
    const label = cleanString(e.label, 40)
    const domain = cleanString(e.domain, 60)
    const capacityRaw = e.capacity
    const capacity =
      typeof capacityRaw === 'number' && Number.isFinite(capacityRaw)
        ? Math.max(1, Math.min(MAX_CAPACITY, Math.trunc(capacityRaw)))
        : null
    if (!key || !label || !domain || capacity === null || seenGroupKeys.has(key.toLowerCase())) continue
    seenGroupKeys.add(key.toLowerCase())
    slotGroups.push({ key, label, capacity, domain })
    if (slotGroups.length >= MAX_SLOT_GROUPS) break
  }

  // A ladder needs somewhere to go, and a track with neither ladder nor slots
  // has nothing to show. Both are individually optional; being empty of both
  // is the same as having no track.
  if (tiers.length < 2 && slotGroups.length === 0) return null
  if (tiers.length === 1) return { tiers: [], slotGroups }

  return { tiers, slotGroups }
}

/**
 * Why there is no track, when there is no track.
 *
 * `parseAdvancementTrack` collapses three different situations into null, and
 * only one of them is good news:
 *
 *   - `generated`  a usable track came back;
 *   - `declined`   the model deliberately said this universe has no ladder
 *                  and no bounded collections, which the prompt explicitly
 *                  calls a correct, expected answer;
 *   - `unusable`   the field was missing entirely, or present and malformed,
 *                  or held so little that nothing could be rendered.
 *
 * Reporting `unusable` as `declined` is the failure mode this whole column
 * has already been bitten by once: null is a MEANINGFUL value here, so a null
 * that means "the generator fumbled" is indistinguishable from one that means
 * "this world genuinely has no ranks" — and the reassuring reading is the one
 * a person acts on. Whoever clicks the backfill button and is told their
 * universe has no rank ladder deserves to know whether anything was actually
 * asked and answered.
 *
 * An explicit `null`, and an object whose tiers and slot groups are both
 * present and empty, are both read as `declined` — the prompt offers both as
 * ways to say "neither". Everything else that fails to parse is `unusable`.
 */
export type AdvancementTrackOutcome = 'generated' | 'declined' | 'unusable'

export function classifyAdvancementTrack(
  raw: unknown,
  parsed: AdvancementTrack | null = parseAdvancementTrack(raw)
): AdvancementTrackOutcome {
  if (parsed) return 'generated'
  // Explicit null is the prompt's documented way to say "this world has
  // neither". `undefined` is NOT: it means the key never arrived.
  if (raw === null) return 'declined'
  if (!raw || typeof raw !== 'object') return 'unusable'
  const source = raw as { tiers?: unknown; slotGroups?: unknown; slot_groups?: unknown }
  const groups = Array.isArray(source.slotGroups)
    ? source.slotGroups
    : Array.isArray(source.slot_groups)
      ? source.slot_groups
      : undefined
  // Both arrays present and empty is the other documented way to say it.
  const tiersEmpty = Array.isArray(source.tiers) && source.tiers.length === 0
  const groupsEmpty = Array.isArray(groups) && groups.length === 0
  if (tiersEmpty && groupsEmpty) return 'declined'
  // Anything else reaching here had content that could not be rendered.
  return 'unusable'
}

export interface TierProgress {
  /** What to show: a rung's label, or the not-yet-placed reading. */
  label: string
  /**
   * 0-based position on the ladder, or -1 when the character has not been
   * placed on it at all. -1 is not "before the first rung" — it means we have
   * no record, which is a different claim.
   */
  index: number
  total: number
  /** The next rung, when there is one. */
  next: string | null
  /** True when nothing has recorded this character's rank. */
  unplaced: boolean
}

/**
 * Shown when a character has no recorded rank. Deliberately not a rung name:
 * the ladder's own lowest rung is a claim about the fiction, and "we have not
 * recorded this" is a claim about our data.
 */
export const UNPLACED_TIER_LABEL = 'Not yet ranked'

/**
 * Where a character stands on the ladder.
 *
 * An unrecognised or absent tier reads as the FIRST rung rather than as an
 * error: "unranked" is a real starting state, and a character whose stored
 * tier predates the track should look like a beginner, not like a broken row.
 */
export function tierProgress(track: AdvancementTrack | null, tierKey: string | null | undefined): TierProgress | null {
  if (!track || track.tiers.length === 0) return null
  const found = tierKey ? track.tiers.findIndex((t) => t.key.toLowerCase() === tierKey.toLowerCase()) : -1
  if (found < 0) {
    // Previously this fell back to index 0 and rendered the lowest rung. That
    // was a claim we had no basis for, and with nothing writing
    // advancementTier it was the ONLY thing the sheet ever showed: every
    // character in every campaign displayed the bottom rank, permanently,
    // regardless of the fiction. The fallback made a dead column look like a
    // working feature parked at the start.
    //
    // It is also wrong even with a writer. The prompt asks for the lowest rung
    // to be the brand-new state, but a prompt is not a guarantee — if a
    // generated ladder starts at "Iron", mapping "no record" onto index 0
    // reports every veteran as Iron, a rank nobody earned.
    return {
      label: UNPLACED_TIER_LABEL,
      index: -1,
      total: track.tiers.length,
      next: track.tiers[0].label,
      unplaced: true,
    }
  }
  return {
    label: track.tiers[found].label,
    index: found,
    total: track.tiers.length,
    next: found + 1 < track.tiers.length ? track.tiers[found + 1].label : null,
    unplaced: false,
  }
}

/**
 * The key a brand-new character starts on, when the campaign has a ladder.
 *
 * This is the one case where the lowest rung is the right answer WITHOUT
 * trusting the model's ordering: a character being created has not done
 * anything yet, so whatever the bottom of this world's ladder is called, they
 * are on it. Seeding at creation is a real fact; inferring it at render time
 * for an arbitrary character is not.
 */
export function startingTierKey(track: AdvancementTrack | null): string | null {
  if (!track || track.tiers.length === 0) return null
  return track.tiers[0].key
}

/**
 * Resolve a model-proposed rank to a declared rung, or null.
 *
 * Closed shape, same discipline as worldRules: the ladder is the campaign's,
 * and the GM may move a character ALONG it but never invent a rung. A tier the
 * track does not declare is dropped rather than stored, because a stored
 * unknown key renders as "not yet ranked" forever — silently undoing the
 * promotion the fiction just narrated.
 */
export function resolveTierKey(track: AdvancementTrack | null, proposed: unknown): string | null {
  if (!track || typeof proposed !== 'string') return null
  const wanted = proposed.trim().toLowerCase()
  if (!wanted) return null
  const hit = track.tiers.find(
    (t) => t.key.toLowerCase() === wanted || t.label.toLowerCase() === wanted
  )
  return hit ? hit.key : null
}

export interface SlotProgress {
  key: string
  label: string
  filled: number
  capacity: number
}

/**
 * How full each slot group is, counted from the character's own capabilities.
 *
 * Counting rather than storing means there is exactly one record of what a
 * character has learned. A separate "essences: 2" counter would be a second
 * copy of the same fact, and this codebase has spent a lot of this week
 * fixing two records that disagreed.
 */
export function slotProgress(
  track: AdvancementTrack | null,
  capabilityDomains: string[]
): SlotProgress[] {
  if (!track || track.slotGroups.length === 0) return []
  const counts = new Map<string, number>()
  for (const domain of capabilityDomains) {
    if (typeof domain !== 'string') continue
    const key = domain.trim().toLowerCase()
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return track.slotGroups.map((group) => ({
    key: group.key,
    label: group.label,
    // Capped at capacity: a universe can grant more than the track declares,
    // and "5/4" reads as a bug rather than as abundance.
    filled: Math.min(group.capacity, counts.get(group.domain.trim().toLowerCase()) ?? 0),
    capacity: group.capacity,
  }))
}
