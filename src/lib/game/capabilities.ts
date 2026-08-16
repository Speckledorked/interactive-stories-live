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
import { isUniqueConstraintViolation } from './worldUpdaters/uniqueConstraintGuard'

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
  /** Prerequisite node, when this campaign's scaffold has a tree (#82). */
  parentId?: string | null
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
 *
 * "Top-level" for a NEWCOMER means a ROOT of the prerequisite tree (#82) —
 * something with nothing standing in front of it — and additionally tier 1,
 * so a scaffold that has tiers but no declared prerequisites (every node a
 * root) still behaves exactly as it did before the tree existed.
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
        .filter(c => !c.parentId && c.tier <= 1)
        .map(c => ({ capabilityId: c.id, state: 'GLIMPSED' as CapabilityState }))
    case 'OUTSIDER':
      return []
  }
}

// ---------------------------------------------------------------------------
// Prerequisite tree assembly (pure)
// ---------------------------------------------------------------------------

export interface LinkableCapability {
  key: string
  name: string
  domain: string
  tier: number
  /** Prerequisite as declared by generation — a display name, not a key. */
  requires?: string
}

/**
 * Resolve generation's declared prerequisite NAMES into key→parentKey links
 * (#82).
 *
 * Two rules, and they exist for one reason each:
 *
 *  - Same domain. A prerequisite reaching across domains would make one
 *    branch of the scaffold silently un-unlockable until an unrelated one
 *    was trained, which is not what "deeper art" means.
 *
 *  - Strictly lower tier. This is what makes cycles structurally
 *    impossible: every edge decreases tier, so no path can return to where
 *    it started. Cheaper and more honest than detecting cycles after the
 *    fact, and it matches what the generator was asked for.
 *
 * Anything that fails to resolve is dropped, not repaired — a node with an
 * unresolvable prerequisite becomes a root, which is always playable. A
 * generator that names something that doesn't exist should cost the tree
 * one edge, never the campaign its capability scaffold.
 */
export function resolvePrerequisiteLinks(
  nodes: LinkableCapability[]
): Array<{ key: string; parentKey: string }> {
  const byDomain = new Map<string, LinkableCapability[]>()
  for (const node of nodes) {
    const domain = node.domain.toLowerCase()
    const list = byDomain.get(domain)
    if (list) list.push(node)
    else byDomain.set(domain, [node])
  }

  const links: Array<{ key: string; parentKey: string }> = []
  for (const node of nodes) {
    const wanted = node.requires?.trim().toLowerCase()
    if (!wanted) continue
    const siblings = byDomain.get(node.domain.toLowerCase()) || []
    const parent = siblings.find(
      s => s.name.trim().toLowerCase() === wanted && s.tier < node.tier && s.key !== node.key
    )
    if (parent) links.push({ key: node.key, parentKey: parent.key })
  }
  return links
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
 * Prerequisite gate (pure): may this character UNLOCK this node, given what
 * they've done with its parent? (#82)
 *
 * A deeper art requires the art it grows out of. The bar is UNLOCKED, not a
 * proficiency threshold: you must genuinely be able to do the foundational
 * thing, but you don't have to be good at it — and a numeric bar would
 * interact badly with the per-arc growth cap, stalling a branch for two
 * full arcs behind a number no player can see.
 *
 * `parentState` is the character's own row for the parent node, or null
 * when they have none. A node with no parent is ungated, which is every
 * node in a campaign generated before the tree existed.
 *
 * Glimpsing is never gated — as with shadow arts, anyone may learn that a
 * deeper art EXISTS. Only doing it requires the groundwork.
 */
export function prerequisiteUnlockBlocked(
  node: { parentId?: string | null; isNarrated?: boolean },
  parentState: { state: CapabilityState } | null | undefined,
  // #386: how many capabilities the character has already UNLOCKED in this
  // node's domain. Only consulted for a parentless NARRATED node — see
  // below. Omitted means "not checked", which preserves the exact
  // pre-#386 behaviour for every caller that doesn't supply it.
  domainUnlockedCount?: number
): boolean {
  if (!node.parentId) {
    // A parentless GENERATED node is a root, and roots are ungated by
    // design — that is what the comment above describes, and it is true of
    // every node in a campaign generated before the tree existed.
    //
    // A parentless NARRATED node is a different animal: it is parentless
    // because the AI just invented it, not because the world's designers
    // placed it at the foundation. Ungating it means the model can name a
    // deep art into existence and hand it over in the same scene, which is
    // exactly the bypass. It needs the same shape of groundwork a real
    // deeper art needs — some genuine footing in its own domain — without
    // requiring a specific parent it doesn't have.
    if (node.isNarrated && domainUnlockedCount !== undefined) {
      return domainUnlockedCount === 0
    }
    return false
  }
  return parentState?.state !== 'UNLOCKED'
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
      // The findFirst above just confirmed no matching node exists yet, so
      // this create should never actually collide — but this runs inside
      // stateUpdater.ts's single transaction wrapping the whole scene's
      // world_updates (#279), and two genuinely concurrent scenes both
      // narrating the same newly-discovered capability at once is exactly
      // the race a plain check-then-create can't close. Every sibling
      // applier (NPC, Faction, Quest) already guards this same shape;
      // capabilities was the one that hadn't adopted it.
      // #386: a node the narrator invents must not be BORN exempt from the
      // gates a generated node is subject to.
      //
      // Created parentless and non-shadow, it satisfied
      // prerequisiteUnlockBlocked (returns false with no parentId) and
      // shadowUnlockBlocked (returns false when not shadow) trivially — so
      // the AI could name a capability into existence and unlock it in the
      // same breath, while an authored one required groundwork and
      // corruption. The defaults were written for LEGACY rows and applied
      // to new ones by accident.
      //
      // Inherit what the domain already establishes rather than inventing
      // a position in the tree: if this world's Blood Sorcery is a shadow
      // art, a newly-named branch of it is a shadow art too.
      const domain = change.domain || 'General'
      const siblings = await db.campaignCapability.findMany({
        where: { campaignId, domain },
        select: { id: true, tier: true, isShadow: true, parentId: true },
        orderBy: { tier: 'asc' },
      })
      const inheritedShadow = siblings.length > 0 && siblings.every((n) => n.isShadow)
      // Attach under the domain's root only when there is exactly one
      // unambiguous candidate — guessing a position in a branching tree
      // would be worse than leaving it a root, and isNarrated below is
      // what gates a root that has no parent to require.
      const roots = siblings.filter((n) => !n.parentId)
      const inheritedParentId = roots.length === 1 ? roots[0].id : null

      try {
        node = await db.campaignCapability.create({
          data: {
            campaignId,
            key,
            name: change.name || change.capability_key,
            domain,
            // Nodes born mid-story were unknown to everyone — secret until
            // each character glimpses them through the fiction.
            isSecret: true,
            isShadow: inheritedShadow,
            parentId: inheritedParentId,
            isNarrated: true,
          },
        })
        log.push(`New capability discovered in this world: ${node.name}`)
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error
        node = await db.campaignCapability.findFirst({ where: { campaignId, key } })
        if (!node) throw error
        console.warn(`  ⚠️ capability "${key}" collided with an existing node at write time — reusing it rather than aborting the scene`)
      }
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

      // Prerequisite gate (#82): a deeper art needs the art it grows out
      // of. Checked before the shadow gate because it's the cheaper and
      // more common refusal, and because a node can be both.
      if (node.parentId || node.isNarrated) {
        const parentState = node.parentId
          ? await db.characterCapability.findUnique({
              where: { characterId_capabilityId: { characterId, capabilityId: node.parentId } },
              select: { state: true },
            })
          : null
        // #386: only needed for the parentless-narrated case, so it is only
        // paid for there.
        const domainUnlockedCount =
          !node.parentId && node.isNarrated
            ? await db.characterCapability.count({
                where: { characterId, state: 'UNLOCKED', capability: { domain: node.domain } },
              })
            : undefined
        if (prerequisiteUnlockBlocked(node, parentState, domainUnlockedCount)) {
          const parent = node.parentId
            ? await db.campaignCapability.findUnique({
                where: { id: node.parentId },
                select: { name: true },
              })
            : null
          const parentName = parent?.name || `the basics of ${node.domain}`
          // Same shape as the shadow refusal: remember that it exists,
          // unlock nothing. The log line goes into the resolution summary,
          // so the narrator learns the prerequisite for future turns rather
          // than proposing the same blocked unlock every scene.
          if (!existing) {
            await db.characterCapability.create({
              data: {
                characterId,
                capabilityId: node.id,
                state: 'GLIMPSED',
                hint: change.hint || `Beyond reach without ${parentName} first`,
                source: change.reason,
                arcStartTurn: currentTurn,
              },
            })
          }
          log.push(`${node.name} is out of reach — ${parentName} has to come first`)
          console.warn(`  🔒 prerequisite gate: unlock of "${node.name}" blocked — "${parentName}" not unlocked`)
          continue
        }
      }

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
