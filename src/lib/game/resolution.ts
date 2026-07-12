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
import { BASIC_MOVES, calculateOutcome } from '@/lib/pbta-moves'
import { proficiencyBand, ProficiencyBand } from './capabilities'
import { AI_MODELS } from '@/lib/ai/models'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionClassification {
  action_index: number
  move_name: string // one of BASIC_MOVES names, or "no_roll"
  stat_key: string // cool | hard | hot | sharp | weird
  capability_key: string | null // relevant capability name, if any
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
  harmPenalty: number
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
  capabilities: Array<{
    state: 'GLIMPSED' | 'UNLOCKED'
    proficiency: number
    framedLabel: string | null
    capability: { key: string; name: string }
  }>
}

/**
 * Roll one classified action. Pure given an injected RNG.
 * Returns null for no_roll classifications or unknown moves.
 */
export function computeMechanics(
  classification: ActionClassification,
  action: { id: string },
  character: CharacterForRoll,
  rng: Rng
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

  const harmMod = harmPenalty(character.harm)
  const dice: [number, number] = [rollD6(rng), rollD6(rng)]
  const total = dice[0] + dice[1] + statMod + capabilityMod + harmMod
  const outcome = calculateOutcome(total)
  const outcomeText = move.outcomes[outcome] || ''

  return {
    actionId: action.id,
    characterId: character.id,
    characterName: character.name,
    moveName: move.name,
    statKey,
    statMod,
    capabilityName,
    capabilityMod,
    harmPenalty: harmMod,
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
    }))
}

async function classifyActions(
  actions: Array<{ actionText: string }>,
  characters: CharacterForRoll[],
  actionCharacterIds: string[]
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
      return `${i}. ${character?.name || 'Unknown'}: "${a.actionText}"${knownCaps ? ` [known abilities: ${knownCaps}]` : ''}`
    })
    .join('\n')

  const prompt = `Classify each tabletop RPG player action to the move it triggers.

MOVES:
${MOVE_LIST_FOR_PROMPT}
- "no_roll": pure dialogue, planning, observation without pressure, or trivial activity — nothing is risked, so no dice

STATS (pick the one that governs the attempt): cool (nerve/composure), hard (force/violence), hot (charm/manipulation), sharp (perception/wits), weird (the strange/supernatural).

ACTIONS:
${actionLines}

Rules:
- Only classify a move when the fiction has real stakes or opposition. Default to "no_roll" when in doubt.
- capability_key: if the action leans on one of the character's listed known abilities (or clearly on a specific learnable system, even one they lack), name it; else null.

Return JSON: {"classifications": [{"action_index": 0, "move_name": "Act Under Fire", "stat_key": "cool", "capability_key": "Swordplay"}]}`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
    return parseClassifications(JSON.parse(data.choices[0].message.content), actions.length)
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
    const characterRows = await prisma.character.findMany({
      where: { id: { in: Array.from(new Set(pendingActions.map(a => a.characterId))) } },
      include: {
        capabilities: {
          include: { capability: { select: { key: true, name: true } } },
        },
      },
    })
    const characters: CharacterForRoll[] = characterRows.map(c => ({
      id: c.id,
      name: c.name,
      stats: (c.stats as Record<string, number> | null) || null,
      harm: c.harm,
      capabilities: c.capabilities as any,
    }))

    const classifications = await classifyActions(
      pendingActions,
      characters,
      pendingActions.map(a => a.characterId)
    )
    if (classifications.length === 0) return []

    const mechanics: ActionMechanics[] = []
    for (const classification of classifications) {
      const action = pendingActions[classification.action_index]
      const character = characters.find(c => c.id === action.characterId)
      if (!character) continue
      const rolled = computeMechanics(classification, action, character, rng)
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
            modifier: m.statMod + m.capabilityMod + m.harmPenalty,
            total: m.total,
            outcome: m.outcome,
            description: `${m.moveName} (+${m.statKey}${m.capabilityName ? `, ${m.capabilityName}` : ''}${m.harmPenalty ? ', impaired' : ''})`,
          }
        }),
      })
      console.log(`🎲 Rolled ${mechanics.length} move(s): ${mechanics.map(m => `${m.characterName} ${m.moveName}=${m.outcome}`).join('; ')}`)
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
    ...(m.harmPenalty ? [`${m.harmPenalty} impaired`] : []),
  ].join(', ')
  const band = m.outcome === 'strongHit' ? 'strong hit' : m.outcome === 'weakHit' ? 'weak hit' : 'miss'
  return `${m.moveName}: 2d6 (${m.dice[0]}+${m.dice[1]}) ${mods} = ${m.total} — ${band}`
}
