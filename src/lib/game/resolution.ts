import { openaiFetch } from '@/lib/ai/openaiCompat'
// src/lib/game/resolution.ts
// The mechanical spine: server-rolled PbtA move resolution.
//
// Before the AI GM narrates an exchange, each pending player action is
// classified to a basic move (or no_roll for pure dialogue/description), a
// 2d6+modifier roll happens HERE — never in the model — and the outcome
// band (strong hit / weak hit / miss) is handed to the narrator as a
// binding constraint. The AI decides *how* it happened; the dice decide
// *how well*.
//
// Presentation philosophy (deliberate, see the knowledge-relative-sheet
// work): mechanics stay under the hood. Prose never mentions dice or
// moves; roll receipts are stored per scene and rendered only in the
// opt-in transparency panel, so skeptics can verify the game is fair
// without the surface feeling gamified.
//
// Everything fails open: if classification errors or a character can't be
// matched, the action simply resolves freeform, exactly as before this
// system existed.

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { BASIC_MOVES, calculateOutcome } from '@/lib/pbta-moves'
import { MAX_CORRUPTION, CORRUPTION_SURGE_BONUS } from './corruption'
import { proficiencyBand, ProficiencyBand } from './capabilities'
import { effectiveStandingModifier } from './standing'
import { AI_MODELS } from '@/lib/ai/models'
import { recordAICost, estimateTokenCount } from '@/lib/ai/cost-tracker'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionClassification {
  action_index: number
  move_name: string // one of BASIC_MOVES names, or "no_roll"
  stat_key: string // cool | hard | hot | sharp | weird
  capability_key: string | null // relevant capability name, if any
  // Faction whose regard is in play for social/political leverage —
  // standing with it modifies the roll (see lib/game/standing.ts).
  faction_name: string | null
  // A specific NPC whose personal opinion of the character is in play —
  // distinct from faction_name (an institution's regard vs. one person's).
  // Modifies the roll from Character.relationships (trust/tension/respect),
  // set by relationship_changes in stateUpdater.ts. Optional/null when the
  // action isn't leaning on a specific relationship.
  npc_name?: string | null
  // True when this action invokes the character's open corruption bargain
  // (see lib/game/corruption.ts) — grants the surge bonus at roll time.
  // Optional: absent means false.
  accepts_bargain?: boolean
}

export interface ActionMechanics {
  actionId: string
  characterId: string
  characterName: string
  moveName: string
  statKey: string
  statMod: number
  capabilityName: string | null
  capabilityMod: number
  factionName: string | null
  standingMod: number
  npcName: string | null
  relationshipMod: number
  weatherCondition: string | null
  weatherMod: number
  harmPenalty: number
  // CORRUPTION_SURGE_BONUS when this roll invoked an open bargain, else 0.
  // A non-zero value is also the signal that a mark MUST land this scene
  // (see ensureSurgeCorruptionChanges in corruption.ts).
  corruptionSurgeBonus: number
  dice: [number, number]
  total: number
  outcome: 'strongHit' | 'weakHit' | 'miss'
  outcomeText: string // the move's band text — what this outcome MEANS
}

export type Rng = () => number

// ---------------------------------------------------------------------------
// Pure mechanics
// ---------------------------------------------------------------------------

export function rollD6(rng: Rng): number {
  return Math.floor(rng() * 6) + 1
}

export const PBTA_STAT_KEYS = ['cool', 'hard', 'hot', 'sharp', 'weird'] as const

/**
 * How much a relevant capability shifts the roll. Urban Shadows blend:
 * your standing with a system matters as much as raw stats.
 *  - not unlocked (glimpsed or unknown): -1 — you're attempting something
 *    you don't actually know how to do
 *  - novice: 0, competent/skilled: +1, masterful: +2
 */
export function capabilityModifier(unlocked: boolean, band: ProficiencyBand): number {
  if (!unlocked) return -1
  switch (band) {
    case 'masterful': return 2
    case 'skilled':
    case 'competent': return 1
    default: return 0
  }
}

/** Existing harm rule (see the <mechanics> prompt): 4-5 harm = Impaired, -1 to rolls. */
export function harmPenalty(harm: number): number {
  return harm >= 4 ? -1 : 0
}

export interface CharacterForRoll {
  id: string
  name: string
  stats: Record<string, number> | null
  harm: number
  // Corruption bargain state — only relevant in campaigns with a theme.
  corruption?: number
  pendingBargainOffer?: string | null
  capabilities: Array<{
    state: 'GLIMPSED' | 'UNLOCKED'
    proficiency: number
    framedLabel: string | null
    capability: { key: string; name: string }
  }>
  // Per-NPC/faction trust/tension/respect/fear, keyed by entity id — see
  // relationship_changes in lib/ai/client.ts and stateUpdater.ts's writer.
  // Only the NPC-keyed entries are read here (see RelationshipForRoll).
  relationships?: Record<string, { trust: number; tension: number; respect: number; fear: number }> | null
}

// The faction side of a roll, resolved by the orchestrator from the
// classifier's faction_name against LIVE simulation state — this is where
// the offscreen tick reaches into the dice.
export interface FactionForRoll {
  name: string
  isActive: boolean
  influence: number
  standing: number // this character's standing value, 0 if no row
}

// The NPC-relationship side of a roll — parallel to FactionForRoll, but for
// one person's regard rather than an institution's. trust/tension/respect
// are net socially (goodwill vs. friction); fear is deliberately excluded
// from the modifier below since it cuts both ways depending on the move
// (an asset for intimidation, a liability for persuasion) and the
// classifier doesn't currently signal which — safer to leave it purely
// narrative than to guess wrong on a mechanical bonus.
export interface RelationshipForRoll {
  npcName: string
  trust: number
  tension: number
  respect: number
}

/**
 * How much a personal relationship shifts a roll. Same banding philosophy
 * as effectiveStandingModifier (lib/game/standing.ts): a single deterministic
 * scalar, capped at ±2 so it stays in line with the other modifiers. Net
 * goodwill (trust + respect - tension, each -100..100) scaled down by 50 —
 * a maxed-out warm relationship (trust 100, respect 100, tension 0) hits the
 * +2 cap; a maxed-out hostile one (tension 100, trust/respect 0) hits -2.
 */
export function relationshipModifier(rel: RelationshipForRoll | null | undefined): number {
  if (!rel) return 0
  const netGoodwill = rel.trust + rel.respect - rel.tension
  return Math.max(-2, Math.min(2, Math.round(netGoodwill / 50)))
}

// The weather side of a roll — resolved by the orchestrator from the
// acting character's currentLocation against the deterministic world tick's
// live weather state (see lib/game/tick/weatherTick.ts). condition is the
// raw WeatherCondition enum value (CLEAR/CLOUDY/RAIN/STORM/SNOW/FOG).
export interface WeatherForRoll {
  condition: string
  severity: number
}

const BENIGN_WEATHER_CONDITIONS = new Set(['CLEAR', 'CLOUDY'])
const SEVERE_WEATHER_SEVERITY_THRESHOLD = 4

/**
 * How much harsh weather shifts a roll — a flat Impaired-style penalty
 * (same magnitude and philosophy as harmPenalty above), not a per-move
 * judgment call about which moves weather "should" affect. Deciding that
 * from a move name would be exactly the kind of keyword-classification
 * guesswork this codebase avoids everywhere else (see the audit note on
 * ComplexExchangeResolver) — a flat, universal penalty when conditions are
 * genuinely bad is simpler and no less honest. CLEAR/CLOUDY never penalize
 * regardless of severity; anything else only bites at severity 4+, the
 * same bar weatherTick.ts's own SEVERE_CONDITIONS uses for MAJOR-worthy
 * weather history entries.
 */
export function weatherPenalty(weather: WeatherForRoll | null | undefined): number {
  if (!weather) return 0
  if (BENIGN_WEATHER_CONDITIONS.has(weather.condition)) return 0
  return weather.severity >= SEVERE_WEATHER_SEVERITY_THRESHOLD ? -1 : 0
}

// Per-campaign display override for a canonical move (Move.baseMoveKey,
// generated by lib/ai/moveFlavor.ts) — name/outcome text ONLY. Mechanics
// (stat, rollType, which band a total lands in) always come from the fixed
// BASIC_MOVES entry; flavor never participates in the math below.
export interface MoveFlavorForRoll {
  name: string
  outcomes: {
    strongHit?: string
    weakHit?: string
    miss?: string
  }
}

/**
 * Roll one classified action. Pure given an injected RNG.
 * Returns null for no_roll classifications or unknown moves.
 */
export function computeMechanics(
  classification: ActionClassification,
  action: { id: string },
  character: CharacterForRoll,
  rng: Rng,
  faction?: FactionForRoll | null,
  relationship?: RelationshipForRoll | null,
  weather?: WeatherForRoll | null,
  moveFlavor?: MoveFlavorForRoll | null
): ActionMechanics | null {
  if (classification.move_name === 'no_roll') return null
  const move = BASIC_MOVES.find(m => m.name === classification.move_name)
  if (!move) return null

  const statKey = PBTA_STAT_KEYS.includes(classification.stat_key as any)
    ? classification.stat_key
    : 'cool'
  const statMod = Math.max(-3, Math.min(3, Number(character.stats?.[statKey]) || 0))

  let capabilityName: string | null = null
  let capabilityMod = 0
  if (classification.capability_key) {
    const wanted = classification.capability_key.toLowerCase()
    const row = character.capabilities.find(
      r =>
        r.capability.key === wanted ||
        r.capability.name.toLowerCase() === wanted ||
        (r.framedLabel && r.framedLabel.toLowerCase() === wanted)
    )
    if (row) {
      capabilityName = row.framedLabel || row.capability.name
      capabilityMod = capabilityModifier(row.state === 'UNLOCKED', proficiencyBand(row.proficiency))
    } else {
      // The classifier says this action leans on a system the character
      // doesn't know at all — attempting the truly unknown.
      capabilityName = classification.capability_key
      capabilityMod = -1
    }
  }

  // Standing weight against live faction state: 0 for a collapsed
  // faction, capped ±1 at LOW influence, else ±2 — see standing.ts.
  let factionName: string | null = null
  let standingMod = 0
  if (faction) {
    factionName = faction.name
    standingMod = effectiveStandingModifier(faction.standing, faction.isActive, faction.influence)
  }

  // Personal relationship weight, capped ±2 — see relationshipModifier above.
  let npcName: string | null = null
  let relationshipMod = 0
  if (relationship) {
    npcName = relationship.npcName
    relationshipMod = relationshipModifier(relationship)
  }

  // Corruption surge: the classifier says this action invokes the
  // character's open bargain. Only honored when a bargain is actually
  // pending and the character isn't already fully consumed.
  const corruptionSurgeBonus =
    classification.accepts_bargain &&
    character.pendingBargainOffer &&
    (character.corruption ?? 0) < MAX_CORRUPTION
      ? CORRUPTION_SURGE_BONUS
      : 0

  // Weather weight from the character's current location — flat penalty,
  // capped at -1, see weatherPenalty above.
  const weatherCondition = weather && !BENIGN_WEATHER_CONDITIONS.has(weather.condition) ? weather.condition : null
  const weatherMod = weatherPenalty(weather)

  const harmMod = harmPenalty(character.harm)
  const dice: [number, number] = [rollD6(rng), rollD6(rng)]
  const total = dice[0] + dice[1] + statMod + capabilityMod + standingMod + relationshipMod + weatherMod + harmMod + corruptionSurgeBonus
  const outcome = calculateOutcome(total)
  // Flavor overrides display only, and only where it actually supplied text
  // for this band — a partially-flavored move (AI omitted one outcome)
  // still falls back to the generic band text rather than showing blank.
  const outcomeText = moveFlavor?.outcomes[outcome] || move.outcomes[outcome] || ''

  return {
    actionId: action.id,
    characterId: character.id,
    characterName: character.name,
    moveName: moveFlavor?.name || move.name,
    statKey,
    statMod,
    capabilityName,
    capabilityMod,
    factionName,
    standingMod,
    npcName,
    relationshipMod,
    weatherCondition,
    weatherMod,
    harmPenalty: harmMod,
    corruptionSurgeBonus,
    dice,
    total,
    outcome,
    outcomeText,
  }
}

// ---------------------------------------------------------------------------
// AI classification (EFFICIENT model, fail-open)
// ---------------------------------------------------------------------------

const MOVE_LIST_FOR_PROMPT = BASIC_MOVES.map(m => `- "${m.name}": ${m.trigger}`).join('\n')

export function parseClassifications(raw: any, actionCount: number): ActionClassification[] {
  if (!raw || !Array.isArray(raw.classifications)) return []
  const validMoves = new Set([...BASIC_MOVES.map(m => m.name), 'no_roll'])
  return raw.classifications
    .filter(
      (c: any) =>
        Number.isInteger(c?.action_index) &&
        c.action_index >= 0 &&
        c.action_index < actionCount &&
        typeof c?.move_name === 'string' &&
        validMoves.has(c.move_name)
    )
    .map((c: any) => ({
      action_index: c.action_index,
      move_name: c.move_name,
      stat_key: typeof c.stat_key === 'string' ? c.stat_key : 'cool',
      capability_key: typeof c.capability_key === 'string' && c.capability_key ? c.capability_key : null,
      faction_name: typeof c.faction_name === 'string' && c.faction_name ? c.faction_name : null,
      npc_name: typeof c.npc_name === 'string' && c.npc_name ? c.npc_name : null,
      accepts_bargain: c.accepts_bargain === true,
    }))
}

async function classifyActions(
  actions: Array<{ actionText: string }>,
  characters: CharacterForRoll[],
  actionCharacterIds: string[],
  factionNames: string[],
  npcNames: string[],
  campaignId: string,
  sceneId: string
): Promise<ActionClassification[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return []

  const actionLines = actions
    .map((a, i) => {
      const character = characters.find(c => c.id === actionCharacterIds[i])
      const knownCaps = character?.capabilities
        .filter(r => r.state === 'UNLOCKED')
        .map(r => r.framedLabel || r.capability.name)
        .join(', ')
      return `${i}. ${character?.name || 'Unknown'}: "${a.actionText}"${knownCaps ? ` [known abilities: ${knownCaps}]` : ''}${character?.pendingBargainOffer ? ` [OPEN BARGAIN: ${character.pendingBargainOffer}]` : ''}`
    })
    .join('\n')

  const prompt = `Classify each tabletop RPG player action to the move it triggers.

MOVES:
${MOVE_LIST_FOR_PROMPT}
- "no_roll": pure dialogue, planning, observation without pressure, or trivial activity — nothing is risked, so no dice

STATS (pick the one that governs the attempt): cool (nerve/composure), hard (force/violence), hot (charm/manipulation), sharp (perception/wits), weird (the strange/supernatural).
${factionNames.length > 0 ? `\nFACTIONS in this world: ${factionNames.join(', ')}\n` : ''}${npcNames.length > 0 ? `\nNPCs in this world: ${npcNames.join(', ')}\n` : ''}
ACTIONS:
${actionLines}

Rules:
- Only classify a move when the fiction has real stakes or opposition. Default to "no_roll" when in doubt.
- capability_key: if the action leans on one of the character's listed known abilities (or clearly on a specific learnable system, even one they lack), name it; else null.
- faction_name: if the action is social/political leverage aimed at (or invoking the name/backing of) one of the listed FACTIONS — negotiating with its members, trading on its reputation, moving through its territory openly — name that faction exactly as listed; else null. Physical actions with no social dimension get null.
- npc_name: if the action is aimed at persuading, appealing to, threatening, or otherwise leveraging ONE SPECIFIC NPC's personal opinion of the character (not their faction's) — name that NPC exactly as listed; else null. An action can name a faction OR an NPC OR neither, but naming both only makes sense if the character is explicitly working an individual within their own institution.
- accepts_bargain: true ONLY if that action's line shows an [OPEN BARGAIN: ...] AND the action clearly reaches for / accepts / draws on that offered power. Refusing it, ignoring it, or doing something unrelated is false. Actions with no open bargain are always false.

Return JSON: {"classifications": [{"action_index": 0, "move_name": "Act Under Fire", "stat_key": "cool", "capability_key": "Swordplay", "faction_name": null, "npc_name": null, "accepts_bargain": false}]}`

  const startTime = Date.now()
  try {
    const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: AI_MODELS.EFFICIENT,
        messages: [
          { role: 'system', content: 'You classify RPG actions to game moves. JSON only.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
    })
    if (!response.ok) {
      console.error('Action classification API error:', response.status)
      return []
    }
    const data = await response.json()
    const content = data.choices[0].message.content
    const usage = data.usage || {}
    // Every scene-resolution turn makes this call — it needs to be in the
    // metered billing total (resolutionBilling.ts) just as much as the
    // narration call, or the classifier's real cost silently falls outside
    // what players are charged for.
    await recordAICost({
      campaignId,
      sceneId,
      model: AI_MODELS.EFFICIENT,
      requestType: 'action_classification',
      inputTokens: usage.prompt_tokens || estimateTokenCount(prompt),
      outputTokens: usage.completion_tokens || estimateTokenCount(content),
      responseTimeMs: Date.now() - startTime,
      success: true,
    }).catch(console.error)
    return parseClassifications(JSON.parse(content), actions.length)
  } catch (error) {
    // Fail open: unclassified actions resolve freeform, as they always did.
    console.error('Action classification failed (failing open):', error)
    return []
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Classify + roll every pending action in an exchange, persist DiceRoll
 * receipts, and return the mechanics for prompt-building. Any failure
 * returns [] — the scene resolves freeform rather than blocking play.
 */
export async function resolveActionMechanics(
  campaignId: string,
  sceneId: string,
  pendingActions: Array<{ id: string; characterId: string; userId: string; actionText: string }>,
  rng: Rng = Math.random
): Promise<ActionMechanics[]> {
  if (pendingActions.length === 0) return []

  try {
    const [characterRows, factionRows, npcRows, locationRows, moveFlavorRows] = await Promise.all([
      prisma.character.findMany({
        where: { id: { in: Array.from(new Set(pendingActions.map(a => a.characterId))) } },
        include: {
          capabilities: {
            include: { capability: { select: { key: true, name: true } } },
          },
          factionStandings: { select: { factionId: true, value: true } },
        },
      }),
      // ALL factions, active or not: standing with a collapsed faction
      // must resolve (to zero weight), not silently miss the lookup.
      prisma.faction.findMany({
        where: { campaignId },
        select: { id: true, name: true, isActive: true, influence: true, isDiscovered: true },
      }),
      // Discovered NPCs only — same fog-of-war rule as factions below: you
      // can't knowingly work a relationship with someone the party hasn't met.
      prisma.nPC.findMany({
        where: { campaignId, isDiscovered: true },
        select: { id: true, name: true },
      }),
      // Live weather per location (see lib/game/tick/weatherTick.ts) —
      // matched against each acting character's currentLocation below.
      prisma.location.findMany({
        where: { campaignId },
        select: { name: true, weather: true, weatherSeverity: true },
      }),
      // Per-campaign move flavor (see lib/ai/moveFlavor.ts) — rows with no
      // baseMoveKey are legacy/export-only content and never matched here.
      prisma.move.findMany({
        where: { campaignId, baseMoveKey: { not: null } },
        select: { baseMoveKey: true, name: true, outcomes: true },
      }),
    ])
    const moveFlavorByKey = new Map(
      moveFlavorRows.map(m => [m.baseMoveKey as string, { name: m.name, outcomes: m.outcomes as MoveFlavorForRoll['outcomes'] }])
    )
    const characters: CharacterForRoll[] = characterRows.map(c => ({
      id: c.id,
      name: c.name,
      stats: (c.stats as Record<string, number> | null) || null,
      harm: c.harm,
      corruption: c.corruption,
      pendingBargainOffer: (c.pendingBargain as any)?.offer || null,
      capabilities: c.capabilities as any,
      relationships: (c.relationships as any) || null,
    }))
    const standingsByCharacter = new Map(
      characterRows.map(c => [c.id, new Map(c.factionStandings.map(s => [s.factionId, s.value]))])
    )
    const currentLocationByCharacter = new Map(characterRows.map(c => [c.id, c.currentLocation]))
    const weatherByLocationName = new Map(
      locationRows.map(l => [l.name.toLowerCase(), { condition: l.weather as string, severity: l.weatherSeverity }])
    )

    const classifications = await classifyActions(
      pendingActions,
      characters,
      pendingActions.map(a => a.characterId),
      // Only discovered, active factions are offered as classifier
      // targets — you can't knowingly trade on the name of a faction the
      // party hasn't met or one that no longer exists.
      factionRows.filter(f => f.isActive && f.isDiscovered).map(f => f.name),
      npcRows.map(n => n.name),
      campaignId,
      sceneId
    )
    if (classifications.length === 0) return []

    const mechanics: ActionMechanics[] = []
    for (const classification of classifications) {
      const action = pendingActions[classification.action_index]
      const character = characters.find(c => c.id === action.characterId)
      if (!character) continue

      let factionForRoll: FactionForRoll | null = null
      if (classification.faction_name) {
        const faction = factionRows.find(
          f => f.name.toLowerCase() === classification.faction_name!.toLowerCase()
        )
        if (faction) {
          factionForRoll = {
            name: faction.name,
            isActive: faction.isActive,
            influence: faction.influence,
            standing: standingsByCharacter.get(character.id)?.get(faction.id) ?? 0,
          }
        }
      }

      let relationshipForRoll: RelationshipForRoll | null = null
      if (classification.npc_name) {
        const npc = npcRows.find(n => n.name.toLowerCase() === classification.npc_name!.toLowerCase())
        const rel = npc ? character.relationships?.[npc.id] : null
        // No relationship row yet just means neutral (all zeros) — not "no
        // roll effect vs. an unknown NPC name", which is the null case below.
        if (npc) {
          relationshipForRoll = {
            npcName: npc.name,
            trust: rel?.trust ?? 0,
            tension: rel?.tension ?? 0,
            respect: rel?.respect ?? 0,
          }
        }
      }

      const currentLocation = currentLocationByCharacter.get(character.id)
      const weatherForRoll: WeatherForRoll | null = currentLocation
        ? weatherByLocationName.get(currentLocation.toLowerCase()) ?? null
        : null

      const move = BASIC_MOVES.find(m => m.name === classification.move_name)
      const moveFlavor = move ? moveFlavorByKey.get(move.key) ?? null : null

      const rolled = computeMechanics(classification, action, character, rng, factionForRoll, relationshipForRoll, weatherForRoll, moveFlavor)
      if (rolled) mechanics.push(rolled)
    }

    // Persist receipts — the auditable record behind "the game is fair".
    if (mechanics.length > 0) {
      await prisma.diceRoll.createMany({
        data: mechanics.map(m => {
          const action = pendingActions.find(a => a.id === m.actionId)
          return {
            campaignId,
            sceneId,
            characterId: m.characterId,
            userId: action?.userId || '',
            rollType: 'move',
            dice: m.dice,
            modifier: m.statMod + m.capabilityMod + m.standingMod + m.relationshipMod + m.weatherMod + m.harmPenalty,
            total: m.total,
            outcome: m.outcome,
            description: `${m.moveName} (+${m.statKey}${m.capabilityName ? `, ${m.capabilityName}` : ''}${m.factionName ? `, standing w/ ${m.factionName}` : ''}${m.npcName ? `, rapport w/ ${m.npcName}` : ''}${m.weatherCondition ? `, ${m.weatherCondition.toLowerCase()}` : ''}${m.harmPenalty ? ', impaired' : ''})`,
          }
        }),
      })

      // Also stamp each action row with its roll — the organic advancement
      // system (applyOrganicCharacterGrowth) reads PlayerAction.rollResult
      // to accumulate statUsage, which is what makes stats grow from
      // consistent successful use. Without this write, that whole chain
      // silently never fires.
      await Promise.all(
        mechanics.map(m =>
          prisma.playerAction.update({
            where: { id: m.actionId },
            data: {
              rollResult: {
                stat: m.statKey,
                outcome: m.outcome,
                dice: m.dice,
                total: m.total,
                moveName: m.moveName,
              },
              moveUsed: m.moveName,
              rollRequired: true,
            },
          })
        )
      )
      console.log(`🎲 Rolled ${mechanics.length} move(s): ${mechanics.map(m => `${m.characterName} ${m.moveName}=${m.outcome}`).join('; ')}`)
    }

    // A bargain is an offer for the character's NEXT action — that action
    // just happened (rolled or not), so the window closes either way. The
    // AI can always offer again later.
    const actingWithBargain = characters.filter(
      c => c.pendingBargainOffer && pendingActions.some(a => a.characterId === c.id)
    )
    if (actingWithBargain.length > 0) {
      await prisma.character.updateMany({
        where: { id: { in: actingWithBargain.map(c => c.id) } },
        data: { pendingBargain: Prisma.JsonNull },
      })
    }

    return mechanics
  } catch (error) {
    console.error('Action mechanics failed (failing open — freeform resolution):', error)
    return []
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function describeOutcomeBand(outcome: ActionMechanics['outcome']): string {
  switch (outcome) {
    case 'strongHit': return 'STRONG HIT (they succeed cleanly)'
    case 'weakHit': return 'WEAK HIT (they succeed with a cost, complication, or hard choice)'
    case 'miss': return 'MISS (it goes wrong — make a hard GM move against them)'
  }
}

/** Receipt line for the transparency panel — the only place numbers surface. */
export function formatRollReceipt(m: ActionMechanics): string {
  const mods = [
    `${m.statMod >= 0 ? '+' : ''}${m.statMod} ${m.statKey}`,
    ...(m.capabilityName ? [`${m.capabilityMod >= 0 ? '+' : ''}${m.capabilityMod} ${m.capabilityName}`] : []),
    ...(m.factionName ? [`${m.standingMod >= 0 ? '+' : ''}${m.standingMod} standing (${m.factionName})`] : []),
    ...(m.npcName ? [`${m.relationshipMod >= 0 ? '+' : ''}${m.relationshipMod} rapport (${m.npcName})`] : []),
    ...(m.weatherCondition ? [`${m.weatherMod} ${m.weatherCondition.toLowerCase()}`] : []),
    ...(m.harmPenalty ? [`${m.harmPenalty} impaired`] : []),
    ...(m.corruptionSurgeBonus ? [`+${m.corruptionSurgeBonus} corruption surge (bargain accepted)`] : []),
  ].join(', ')
  const band = m.outcome === 'strongHit' ? 'strong hit' : m.outcome === 'weakHit' ? 'weak hit' : 'miss'
  return `${m.moveName}: 2d6 (${m.dice[0]}+${m.dice[1]}) ${mods} = ${m.total} — ${band}`
}
