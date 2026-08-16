// src/components/__tests__/noRawSimulationNumbers.test.tsx
//
// This product speaks in fiction, not integers. That's a design position
// with rationale on record throughout the codebase: proficiency is banded
// because raw numbers "never leave the server", relationships are hidden
// because "a visible meter turns a relationship into a resource to farm",
// debts render as "Lord Kessler considers you in his debt" and explicitly
// "never as a ledger counter".
//
// Two player-facing surfaces had drifted off that line:
//   - WorldGlance rendered `${name} (threat ${threatLevel})` — "House Vale
//     (threat 4)" on a lobby whose whole job is in-world prose.
//   - EntityStatRow's Location meter printed a bare "72/100", while every
//     sibling meter in the same file passed a qualitative describe*()
//     — and while already calling stabilityTone() on that same value.
//
// lib/game/entityStats.ts has provided the bands the whole time. These
// tests pin the RULE, not the current copy, so the next surface to render
// a faction or a location can't quietly reintroduce a stat block.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  describeThreat,
  describeStability,
  THREAT_MAX,
} from '@/lib/game/entityStats'

const SRC = join(process.cwd(), 'src')

function read(relative: string): string {
  return readFileSync(join(SRC, relative), 'utf-8')
}

describe('diegetic bands cover their full input range', () => {
  it('describeThreat returns a word for every level on the track', () => {
    for (let level = 1; level <= THREAT_MAX; level++) {
      const label = describeThreat(level)
      expect(label, `threat ${level} produced no label`).toBeTruthy()
      expect(label, `threat ${level} leaked a digit: "${label}"`).not.toMatch(/\d/)
    }
  })

  it('describeStability returns a word across the 0-100 range', () => {
    for (const score of [0, 24, 25, 49, 50, 74, 75, 100]) {
      const label = describeStability(score)
      expect(label, `stability ${score} produced no label`).toBeTruthy()
      expect(label, `stability ${score} leaked a digit: "${label}"`).not.toMatch(/\d/)
    }
  })
})

describe('player-facing surfaces render bands, not raw simulation values', () => {
  // Source-level assertions on purpose: these components need a lot of
  // shaped props to render, and the defect being guarded is a literal in
  // the source ("(threat ${...})", "${...}/100") rather than a behaviour
  // that only appears at runtime.

  it('WorldGlance does not print a raw threat integer', () => {
    const source = read('components/campaigns/lobby/WorldGlance.tsx')
    expect(source).not.toMatch(/\(threat \$\{/)
    expect(source).toMatch(/describeThreat\(/)
  })

  it('EntityStatRow bands every meter it renders, including Location condition', () => {
    const source = read('components/wiki/EntityStatRow.tsx')
    // No `display={`${something}/100`}`-shaped template anywhere.
    expect(source).not.toMatch(/display=\{`\$\{[^}]+\}\/\d+`\}/)
    expect(source).toMatch(/display=\{describeStability\(stats\.conditionScore\)\}/)
  })
})

describe('Clocks are called Threads on every player-facing surface', () => {
  // Not a naming debate — a half-applied rename. AITransparencyPanel maps
  // the category label with a comment citing "the Clocks->Threads rename",
  // and both the World tab and the mobile menu already say Threads;
  // ActiveClocksPanel was simply missed.
  it('the story sidebar panel says Threads', () => {
    const source = read('components/scene/ActiveClocksPanel.tsx')
    expect(source).toMatch(/ACTIVE THREADS/)
    expect(source).not.toMatch(/ACTIVE CLOCKS/)
  })

  it('does not tell the player about a "clock" in its empty-detail copy', () => {
    const source = read('components/scene/ActiveClocksPanel.tsx')
    expect(source).not.toMatch(/for this clock yet/)
  })
})
