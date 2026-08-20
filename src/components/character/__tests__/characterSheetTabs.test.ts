// src/components/character/__tests__/characterSheetTabs.test.ts
//
// Every tab must render something, and everything rendered must be reachable.
//
// The Advancement tab held only the growth log — counters and a history
// list. The rank ladder and essence slots, the things a player actually
// looks for when they wonder how far along they are, rendered on the Stats
// tab instead. So a tab named "Advancement" contained no advancement track,
// and the track was somewhere its name did not point. Nothing was broken in
// any way a test could see; the sheet just answered one question in two
// places and neither place said so.
//
// Merging them makes progression read top to bottom on one screen. This
// guard keeps that honest in both directions:
//
//   - a declared tab with no `activeTab === 'key'` block renders an empty
//     pane, which is what the user reported seeing;
//   - an `activeTab === 'key'` block with no declared tab is JSX nobody can
//     reach, which is the specific thing a tab merge leaves behind when the
//     items list is updated and the render block is not.
//
// Both are invisible to typecheck (the state union permits any member) and
// invisible to unit tests (they render a tab they name explicitly).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SHEET = join(process.cwd(), 'src', 'components', 'character', 'CharacterSheetDisplay.tsx')
const src = readFileSync(SHEET, 'utf-8')

/** Tab keys declared in the Tabs `items` array. */
function declaredTabs(): string[] {
  const start = src.indexOf('aria-label="Character sheet sections"')
  expect(start).toBeGreaterThan(-1)
  const items = src.slice(start, src.indexOf('/>', start))
  return [...items.matchAll(/\{\s*key:\s*'(\w+)'/g)].map((m) => m[1])
}

/** Tab keys that actually have a render block. */
function renderedTabs(): string[] {
  return [...new Set([...src.matchAll(/activeTab === '(\w+)'/g)].map((m) => m[1]))]
}

describe('character sheet tabs', () => {
  const declared = declaredTabs()
  const rendered = renderedTabs()

  it('reads the tab bar', () => {
    // A parser matching nothing would make every assertion below vacuous.
    expect(declared).toContain('overview')
    expect(declared).toContain('stats')
    expect(declared.length).toBeGreaterThanOrEqual(4)
  })

  it('renders every tab it declares', () => {
    const empty = declared.filter((k) => !rendered.includes(k))
    expect(empty, `declared tabs with no render block: ${empty.join(', ')}`).toEqual([])
  })

  it('declares every tab it renders', () => {
    const unreachable = rendered.filter((k) => !declared.includes(k))
    expect(
      unreachable,
      `render blocks no tab can reach: ${unreachable.join(', ')}. A tab merge that ` +
        `updates the items list without removing the old block leaves exactly this.`
    ).toEqual([])
  })

  it('keeps progression on one screen', () => {
    // The merge this guard exists to hold: where you stand (rank ladder,
    // essence slots) and how you got there (the growth log) must be in the
    // same tab, or the split that prompted this comes straight back.
    const statsAt = src.indexOf("activeTab === 'stats'")
    const nextTabAt = [...src.matchAll(/activeTab === '(\w+)'/g)]
      .map((m) => m.index!)
      .filter((i) => i > statsAt)
      .sort((a, b) => a - b)[0]
    expect(statsAt).toBeGreaterThan(-1)
    expect(nextTabAt).toBeGreaterThan(statsAt)

    const statsBlock = src.slice(statsAt, nextTabAt)
    for (const marker of ['<CardLabel>Advancement</CardLabel>', 'Growth History', 'Abilities & Knowledge']) {
      expect(statsBlock, `"${marker}" left the combined progression tab`).toContain(marker)
    }
  })

  it('no longer has a tab whose name promises a track it does not show', () => {
    expect(declared).not.toContain('advancement')
  })
})
