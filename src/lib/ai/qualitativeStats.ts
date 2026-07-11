// src/lib/ai/qualitativeStats.ts
// Fog of war — convert exact simulation numbers into qualitative descriptors
// before they reach a player-facing AI prompt. The deterministic tick needs
// exact numbers to function (and reads them straight from Prisma, never
// through these builders), but narration doesn't — handing the AI an exact
// number ("military: 73") makes it trivial for it to blurt out something no
// player could know in-fiction. Reuses factionTick.ts's LOW/MEDIUM/HIGH
// banding — the same thresholds the simulation itself uses to make
// decisions, just described in prose instead of a number.

import { band } from '@/lib/game/tick/factionTick'

const STAT_LABELS: Record<'LOW' | 'MEDIUM' | 'HIGH', string> = {
  LOW: 'weak',
  MEDIUM: 'moderate',
  HIGH: 'strong',
}

export function describeStat(value: number): string {
  return STAT_LABELS[band(value)]
}

const THREAT_LABELS = ['negligible', 'minor', 'notable', 'serious', 'dire']

export function describeThreatLevel(level: number): string {
  return THREAT_LABELS[Math.max(0, Math.min(THREAT_LABELS.length - 1, level - 1))] || 'notable'
}

// War momentum runs -100 (total defender advantage) .. +100 (total attacker
// advantage) — see warTick.ts.
export function describeWarMomentum(momentum: number): string {
  if (momentum >= 40) return 'strongly favors the attacker'
  if (momentum >= 15) return 'favors the attacker'
  if (momentum <= -40) return 'strongly favors the defender'
  if (momentum <= -15) return 'favors the defender'
  return 'evenly matched'
}
