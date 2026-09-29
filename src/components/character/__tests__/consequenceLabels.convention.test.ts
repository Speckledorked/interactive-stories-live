// src/components/character/__tests__/consequenceLabels.convention.test.ts
//
// #475: #292 relabelled freeform debts "Noted Debt" — in ConsequenceBadge,
// as a string literal. CharacterSnapshotModal renders the same array under
// its own heading and never heard about it, so for months the character
// sheet presented possibly-settled flavour text as live obligations: the
// exact confusion #292 set out to end, surviving its own fix.
//
// The defect is not the heading. It is that a label which must be identical
// in two renderers was owned by one of them, so the second could only ever
// agree with it by coincidence. This test is about the third renderer — the
// one that does not exist yet and will otherwise write "DEBTS" too.
//
// Source-scanning, in the same spirit as the other *.convention tests here:
// the thing being checked is that nobody re-types the copy, and a
// re-typed literal is invisible to anything that imports the module.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { CONSEQUENCE_LABELS } from '@/lib/game/consequenceLabels'

const ROOT = join(__dirname, '..', '..', '..')

function componentFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue
      componentFiles(full, out)
    } else if (entry.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

describe('freeform consequence copy has one owner', () => {
  it('says out loud that a noted debt is not a tracked one', () => {
    // The substance of #292, pinned where both renderers can reach it.
    expect(CONSEQUENCE_LABELS.debt.label).toBe('Noted Debt')
    expect(CONSEQUENCE_LABELS.debt.heading).toContain('NOTED')
    expect(CONSEQUENCE_LABELS.debt.note).toBeTruthy()
  })

  it('is not re-typed as a bare heading anywhere in the components tree', () => {
    // `>DEBTS<` / `/>DEBTS</` — a literal heading, as opposed to a
    // `{CONSEQUENCE_LABELS.debt.heading}` interpolation.
    const offenders: string[] = []
    for (const file of componentFiles(join(ROOT, 'components'))) {
      const source = readFileSync(file, 'utf8')
      source.split('\n').forEach((line, i) => {
        if (/>\s*DEBTS\s*</.test(line)) offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`)
      })
    }
    expect(
      offenders,
      `A bare "DEBTS" heading presents freeform, possibly-settled notes as the tracked ` +
        `debt economy. Use CONSEQUENCE_LABELS.debt.heading: ${offenders.join(', ')}`
    ).toEqual([])
  })

  it('is read from the shared module by every renderer of the debts array', () => {
    const renderers = componentFiles(join(ROOT, 'components')).filter((file) =>
      /consequences\.debts|type === 'debt'/.test(readFileSync(file, 'utf8'))
    )
    expect(renderers.length, 'expected to find the renderers this guard is about').toBeGreaterThan(0)

    const adrift = renderers.filter(
      (file) => !readFileSync(file, 'utf8').includes('consequenceLabels')
    )
    expect(
      adrift,
      `Renders freeform debts without the shared label/disclaimer: ${adrift.map((f) => f.slice(ROOT.length + 1)).join(', ')}`
    ).toEqual([])
  })
})
