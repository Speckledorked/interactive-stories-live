// src/lib/game/tick/npcGoalFallback.ts
// Give any NPC whose completed goal the AI didn't replace a deterministic
// follow-up goal. Same guarantee ambitions have (fallbackName/etc in
// types.ts): a completion never silently goes nowhere. Without this, an AI
// failure or skip leaves the NPC's goals text unchanged, so the tick
// re-accrues progress and re-"completes" the identical goal every ~25 turns
// forever, re-emitting a duplicate MAJOR history event each time. The
// template goal is bland on purpose — the next AI pass (or scene contact)
// can overwrite it with something specific.
//
// Called from worldTurn.ts's runWorldTurn AFTER offscreen event generation,
// so it only touches NPCs the AI skipped (or every completed-goal NPC, if
// the AI call failed outright).

import { prisma } from '@/lib/prisma'

// Two alternating templates so a fallback goal that itself completes gets a
// DIFFERENT fallback (strip whichever prefix is present, apply the other) —
// never identical to its predecessor, and never nesting unboundedly.
export const NPC_GOAL_FALLBACK_PREFIXES = ['Build on what was achieved: ', 'Seek a new ambition beyond: '] as const

export async function applyNpcGoalFallbacks(
  campaignId: string,
  completedGoalNpcs: Array<{ npcId: string; npcName: string; completedGoal: string | number }>
) {
  for (const completed of completedGoalNpcs) {
    const npc = await prisma.nPC.findUnique({
      where: { id: completed.npcId },
      select: { goals: true },
    })
    // The AI already gave them a new direction — nothing to do.
    if (!npc || npc.goals !== String(completed.completedGoal)) continue

    const completedText = String(completed.completedGoal)
    const matchedPrefix = NPC_GOAL_FALLBACK_PREFIXES.find((p) => completedText.startsWith(p))
    const coreGoal = matchedPrefix ? completedText.slice(matchedPrefix.length) : completedText
    const nextPrefix = matchedPrefix === NPC_GOAL_FALLBACK_PREFIXES[0]
      ? NPC_GOAL_FALLBACK_PREFIXES[1]
      : NPC_GOAL_FALLBACK_PREFIXES[0]

    await prisma.nPC.update({
      where: { id: completed.npcId },
      data: { goals: `${nextPrefix}${coreGoal}` },
    })
    console.log(`  🎯 Fallback goal set for ${completed.npcName} (AI didn't supply one)`)
  }
}
