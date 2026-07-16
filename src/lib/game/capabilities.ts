// src/lib/game/capabilities.ts
// Knowledge-relative character sheets: the universe has a latent tree of
// learnable systems (CampaignCapability); what a character sees of it
// depends on what the fiction has shown them (CharacterCapability).
//
// Same fog-of-war philosophy as qualitativeStats.ts, pointed inward:
// exact proficiency numbers exist only server-side; players and the
// narration AI only ever see qualitative bands. Growth is organic — the
// AI signals that a capability was revealed / unlocked / meaningfully
// used, and the deterministic math here decides how much that's worth,
// with per-arc caps so "I train every scene" can't speedrun mastery
// (same guardrail philosophy as the world-tick caps).

import { CapabilityState, OriginFamiliarity, Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
// Qualitative bands (the only representation that ever leaves the server)
// ---------------------------------------------------------------------------

export type ProficiencyBand = 'untrained' | 'novice' | 'competent' | 'skilled' | 'masterful'

export const NOVICE_MIN = 10
export const COMPETENT_MIN = 30
export const SKILLED_MIN = 55
export const MASTERFUL_MIN = 80

export function proficiencyBand(proficiency: number): ProficiencyBand {
  if (proficiency >= MASTERFUL_MIN) return 'masterful'
  if (proficiency >= SKILLED_MIN) return 'skilled'
  if (proficiency >= COMPETENT_MIN) return 'competent'
  if (proficiency >= NOVICE_MIN) return 'novice'
  return 'untrained'
}

// ---------------------------------------------------------------------------
// Growth math (pure)
// ---------------------------------------------------------------------------

// Unlocking something puts you at the bottom of "novice" — you can do it,
// badly.
export const UNLOCK_STARTING_PROFICIENCY = NOVICE_MIN

// Growth channels: incidental use in a scene is the slow lane; deliberate
// downtime training is the fast lane. Both diminish as proficiency rises —
// the last points toward mastery are the hardest.
export type GrowthChannel = 'scene' | 'training'

export function computeUsageGain(current: number, channel: GrowthChannel): number {
  if (current >= 100) return 0
  const base = Math.max(1, Math.round((100 - current) / 15))
  const gain = channel === 'training' ? base * 2 : base
  return Math.min(gain, 100 - current)
}

// Per-arc growth guardrail: at most MAX_GROWTH_PER_ARC proficiency points
// per capability per ARC_LENGTH_TURNS-turn window. Deterministic and
// invisible-proof: because players can't see the numbers, the pacing knobs
// have to be firm.
export const ARC_LENGTH_TURNS = 10
export const MAX_GROWTH_PER_ARC = 15

export interface ArcState {
  growthInArc: number
  arcStartTurn: number
}

export interface GuardedGain {
  gain: number
  growthInArc: number
  arcStartTurn: number
}

export function applyArcGuardrail(
  arc: ArcState,
  rawGain: number,
  currentTurn: number
): GuardedGain {
  let { growthInArc, arcStartTurn } = arc
  if (currentTurn - arcStartTurn >= ARC_LENGTH_TURNS) {
    growthInArc = 0
    arcStartTurn = currentTurn
  }
  const budget = Math.max(0, MAX_GROWTH_PER_ARC - growthInArc)
  const gain = Math.min(rawGain, budget)
  return { gain, growthInArc: growthInArc + gain, arcStartTurn }
}

// ---------------------------------------------------------------------------
// Origin seeding (pure)
// ---------------------------------------------------------------------------

export interface SeedableCapability {
  id: string
  tier: number
  isSecret: boolean
}

export interface SeedDecision {
  capabilityId: string
  state: CapabilityState
}

/**
 * What a freshly created character already knows exists, by origin.
 * Seeding is about KNOWLEDGE of the scaffold, never ability: nothing is
 * ever seeded UNLOCKED — what you can actually do must come from the
 * fiction (backstory scenes, training, discovery).
 *
 *  NATIVE   — grew up here: the whole non-secret tree renders (as ???s).
 *  NEWCOMER — has heard of the top-level systems, nothing deeper.
 *  OUTSIDER — a truly blank sheet until the fiction shows them anything.
 */
export function decideSeedStates(
  familiarity: OriginFamiliarity,
  capabilities: SeedableCapability[]
): SeedDecision[] {
  const visible = capabilities.filter(c => !c.isSecret)
  switch (familiarity) {
    case 'NATIVE':
      return visible.map(c => ({ capabilityId: c.id, state: 'GLIMPSED' as CapabilityState }))
    case 'NEWCOMER':
      return visible
        .filter(c => c.tier <= 1)
        .map(c => ({ capabilityId: c.id, state: 'GLIMPSED' as CapabilityState }))
    case 'OUTSIDER':
      return []
  }
}

// ---------------------------------------------------------------------------
// AI-facing change objects and the single DB writer
// ---------------------------------------------------------------------------

export interface CapabilityChange {
  capability_key: string // slug or display name of the node
  change: 'glimpse' | 'unlock' | 'progress'
  is_new?: boolean // creates a new campaign capability node
  name?: string // display name when is_new
  domain?: string // grouping when is_new
  framed_label?: string // the character's own vocabulary for it
  hint?: string // what a "???" sheet entry shows
  reason: string
}

export function slugifyCapabilityKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

type Db = Prisma.TransactionClient

/**
 * Shadow-branch gate (pure): may this character UNLOCK this node right
 * now? Shadow arts are the corruption-priced branch of the capability
 * tree — unlocking one requires corruption marks at least equal to the
 * node's tier (tier 1 = one mark opens the door, tier 3 = deep in).
 * Everything non-shadow is ungated, and campaigns without a corruption
 * theme never set isShadow at all, so nothing changes for them.
 * Glimpsing is never gated — anyone may learn the forbidden EXISTS.
 */
export function shadowUnlockBlocked(
  node: { isShadow: boolean; tier: number },
  corruption: number
): boolean {
  if (!node.isShadow) return false
  return (Number(corruption) || 0) < Math.max(1, node.tier)
}

/**
 * The single writer for capability state. Resolves each change's node by
 * key or name within the campaign (creating a stub node when the AI marks
 * it is_new — same pattern as stub NPCs/factions), then applies:
 *
 *   glimpse  — the fiction showed them this exists (no-op if already known)
 *   unlock   — they can now do it (novice proficiency)
 *   progress — meaningful use/training; deterministic, arc-capped gain
 *
 * Returns human-readable log lines for the resolution summary.
 */
export async function applyCapabilityChanges(
  db: Db,
  campaignId: string,
  characterId: string,
  changes: CapabilityChange[],
  currentTurn: number,
  channel: GrowthChannel = 'scene'
): Promise<string[]> {
  const log: string[] = []

  // Shadow gate context, fetched at most once and only if a shadow node
  // actually comes up (most campaigns/scenes never touch one).
  let shadowCtx: { corruption: number } | null = null
  const getShadowCtx = async () => {
    if (!shadowCtx) {
      const character = await db.character.findUnique({
        where: { id: characterId },
        select: { corruption: true },
      })
      shadowCtx = { corruption: character?.corruption ?? 0 }
    }
    return shadowCtx
  }

  for (const change of changes) {
    const key = slugifyCapabilityKey(change.capability_key)
    if (!key) continue

    // Resolve the campaign node by key, then by display name.
    let node = await db.campaignCapability.findFirst({
      where: {
        campaignId,
        OR: [
          { key },
          { name: { equals: change.capability_key, mode: 'insensitive' } },
        ],
      },
    })

    if (!node) {
      if (!change.is_new) {
        console.warn(`  ❓ capability_changes: unknown capability "${change.capability_key}" (not marked is_new) — skipped`)
        continue
      }
      node = await db.campaignCapability.create({
        data: {
          campaignId,
          key,
          name: change.name || change.capability_key,
          domain: change.domain || 'General',
          // Nodes born mid-story were unknown to everyone — secret until
          // each character glimpses them through the fiction.
          isSecret: true,
        },
      })
      log.push(`New capability discovered in this world: ${node.name}`)
    }

    const existing = await db.characterCapability.findUnique({
      where: { characterId_capabilityId: { characterId, capabilityId: node.id } },
    })

    if (change.change === 'glimpse') {
      if (existing) continue // already known — glimpsing again adds nothing
      await db.characterCapability.create({
        data: {
          characterId,
          capabilityId: node.id,
          state: 'GLIMPSED',
          hint: change.hint || null,
          source: change.reason,
          arcStartTurn: currentTurn,
        },
      })
      log.push(`Glimpsed: ${node.name}`)
      continue
    }

    if (change.change === 'unlock') {
      if (existing?.state === 'UNLOCKED') continue
      if (node.isShadow) {
        const ctx = await getShadowCtx()
        if (shadowUnlockBlocked(node, ctx.corruption)) {
          // The forbidden art refuses the insufficiently marked: downgrade
          // to a glimpse so the sheet remembers it exists, but nothing
          // unlocks until corruption catches up to the node's tier.
          if (!existing) {
            await db.characterCapability.create({
              data: {
                characterId,
                capabilityId: node.id,
                state: 'GLIMPSED',
                hint: change.hint || 'It resists you — it wants more of you first',
                source: change.reason,
                arcStartTurn: currentTurn,
              },
            })
          }
          log.push(`${node.name} resists — it demands a deeper price than has yet been paid`)
          console.warn(`  🌑 shadow gate: unlock of "${node.name}" (tier ${node.tier}) blocked at corruption ${ctx.corruption} — downgraded to glimpse`)
          continue
        }
      }
      await db.characterCapability.upsert({
        where: { characterId_capabilityId: { characterId, capabilityId: node.id } },
        create: {
          characterId,
          capabilityId: node.id,
          state: 'UNLOCKED',
          proficiency: UNLOCK_STARTING_PROFICIENCY,
          framedLabel: change.framed_label || null,
          source: change.reason,
          unlockedAt: new Date(),
          arcStartTurn: currentTurn,
        },
        update: {
          state: 'UNLOCKED',
          proficiency: UNLOCK_STARTING_PROFICIENCY,
          framedLabel: change.framed_label || existing?.framedLabel || null,
          source: change.reason,
          unlockedAt: new Date(),
        },
      })
      log.push(`Unlocked: ${node.name}`)
      continue
    }

    // progress
    if (!existing || existing.state !== 'UNLOCKED') {
      console.warn(`  ❓ capability_changes: progress on locked/unknown "${node.name}" — skipped`)
      continue
    }
    const raw = computeUsageGain(existing.proficiency, channel)
    const guarded = applyArcGuardrail(
      { growthInArc: existing.growthInArc, arcStartTurn: existing.arcStartTurn },
      raw,
      currentTurn
    )
    const before = proficiencyBand(existing.proficiency)
    const after = proficiencyBand(existing.proficiency + guarded.gain)
    await db.characterCapability.update({
      where: { id: existing.id },
      data: {
        proficiency: existing.proficiency + guarded.gain,
        usageCount: { increment: 1 },
        growthInArc: guarded.growthInArc,
        arcStartTurn: guarded.arcStartTurn,
      },
    })
    if (after !== before) {
      log.push(`${node.name}: now ${after}`)
    }
  }

  return log
}

// ---------------------------------------------------------------------------
// Read-side shaping (shared by prompt building and the sheet API)
// ---------------------------------------------------------------------------

export interface CapabilityRowForDisplay {
  state: CapabilityState
  proficiency: number
  framedLabel: string | null
  hint: string | null
  capability: { name: string; domain: string; description: string | null }
}

export interface CharacterCapabilitySummary {
  known: Array<{ name: string; domain: string; band: ProficiencyBand; description: string | null }>
  glimpsed: Array<{ domain: string; hint: string | null }>
  knownDomains: string[]
}

/**
 * Collapse raw rows into the only shape players (and the narration AI)
 * are allowed to see: unlocked entries with qualitative bands and the
 * character's own labels, glimpsed entries as anonymous hints, and the
 * list of domains the character knows exist. Exact numbers stay behind.
 */
export function summarizeCapabilities(rows: CapabilityRowForDisplay[]): CharacterCapabilitySummary {
  const known = rows
    .filter(r => r.state === 'UNLOCKED')
    .map(r => ({
      name: r.framedLabel || r.capability.name,
      domain: r.capability.domain,
      band: proficiencyBand(r.proficiency),
      description: r.capability.description,
    }))
  const glimpsed = rows
    .filter(r => r.state === 'GLIMPSED')
    .map(r => ({ domain: r.capability.domain, hint: r.hint }))
  const knownDomains = Array.from(new Set(rows.map(r => r.capability.domain))).sort()
  return { known, glimpsed, knownDomains }
}
