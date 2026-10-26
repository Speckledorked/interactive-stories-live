// src/lib/game/__tests__/worldEventPhrasing.test.ts
// #522: the two properties that make WorldEvent safe to show a player at
// all — no raw values reach the fiction, and an unknown type says nothing.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { globSync } from 'glob'
import {
  phraseWorldEvent,
  phrasedTypes,
  phrasedFields,
  changeDirection,
  SILENT_TYPES,
} from '../worldEventPhrasing'

const TICK_GLOB = join(__dirname, '..', 'tick', '*.ts')

/** Every `field: '...'` literal the tick handlers write. */
function tickFieldNames(): Set<string> {
  const fields = new Set<string>()
  for (const file of globSync(TICK_GLOB).filter((f) => !f.includes('__tests__'))) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\bfield:\s*'([a-zA-Z_.]+)'/g)) {
      fields.add(match[1])
    }
  }
  return fields
}

/** Every field either layer has an opinion about, plus the silent ones. */
function phrasedFieldNames(): Set<string> {
  const fromTypes = [...phrasedTypes(), ...SILENT_TYPES].map((k) => k.slice(k.indexOf('.') + 1))
  return new Set([...fromTypes, ...phrasedFields()])
}

/** Just the type layer's fields — the only ones a staleness check can
 *  speak to. See the stale test for why. */
function typeLayerFieldNames(): Set<string> {
  const keys = [...phrasedTypes(), ...SILENT_TYPES]
  return new Set(keys.map((k) => k.slice(k.indexOf('.') + 1)))
}

describe('phraseWorldEvent', () => {
  it('never puts a raw value in the sentence', () => {
    // The anti-spreadsheet property. Feeding every phrased type a pair of
    // distinctive numbers proves the values are read for direction and
    // then dropped, rather than interpolated — which is the whole reason
    // this module exists instead of a template in a component.
    for (const type of phrasedTypes()) {
      for (const [previousValue, newValue] of [
        ['41', '87'],
        ['87', '41'],
      ]) {
        const phrased = phraseWorldEvent({
          type,
          targetName: 'The Iron Company',
          previousValue,
          newValue,
        })
        if (!phrased) continue
        expect(phrased.text, `${type} leaked a value`).not.toMatch(/\d/)
      }
    }
  })

  it('says nothing for a type it has never heard of', () => {
    // Fails closed: a new tick handler reaches players as silence, not as
    // "faction.someNewInternalField changed".
    expect(
      phraseWorldEvent({
        type: 'faction.someFieldInventedTomorrow',
        targetName: 'The Iron Company',
        previousValue: '1',
        newValue: '2',
      })
    ).toBeNull()
  })

  it('says nothing for a type deliberately kept off-screen', () => {
    for (const type of SILENT_TYPES) {
      expect(
        phraseWorldEvent({ type, targetName: 'The Iron Company', previousValue: '1', newValue: '2' })
      ).toBeNull()
    }
  })

  it('says nothing when the target has no usable name', () => {
    // Every sentence here is built around a name; without one they read as
    // "'s coffers are thinning".
    for (const targetName of ['', '   ']) {
      expect(
        phraseWorldEvent({ type: 'faction.resources', targetName, previousValue: '1', newValue: '2' })
      ).toBeNull()
    }
  })

  it('distinguishes direction on a field that has one', () => {
    const up = phraseWorldEvent({
      type: 'faction.resources',
      targetName: 'The Iron Company',
      previousValue: '40',
      newValue: '44',
    })
    const down = phraseWorldEvent({
      type: 'faction.resources',
      targetName: 'The Iron Company',
      previousValue: '44',
      newValue: '40',
    })
    expect(up?.text).not.toEqual(down?.text)
    expect(up?.kind).toBe('power')
  })

  it('still speaks for a field whose change is its own content', () => {
    // warDeclared carries no comparable values; the fact of the row is the
    // event, so it must not depend on a direction being readable.
    const phrased = phraseWorldEvent({
      type: 'faction.warDeclared',
      targetName: 'The Iron Company',
      previousValue: null,
      newValue: null,
    })
    // Wording comes from the field layer now (see layer precedence
    // below) — the assertion is that it speaks at all without values.
    expect(phrased?.text).toContain('went to war')
    expect(phrased?.kind).toBe('war')
  })
})

describe('layer precedence', () => {
  // The regression this ordering exists to prevent: the first version put
  // `phrasing.flat` ahead of the field layer, so any caller selecting no
  // values — the absence journal selects none — got the type layer's flat
  // form instead of #396's reviewed line. Four lines changed silently.

  it("uses the reviewed field line when there is no direction to read", () => {
    expect(
      phraseWorldEvent({ type: 'clock.currentTicks', targetName: 'The Siege' })?.text
    ).toBe('The thread on The Siege moved closer to striking.')
    expect(
      phraseWorldEvent({ type: 'faction.collapsed', targetName: 'The Iron Company' })?.text
    ).toBe('The Iron Company fell apart entirely.')
  })

  it('prefers the direction-aware line when values are present', () => {
    // The one thing the type layer knows that the field layer cannot.
    expect(
      phraseWorldEvent({
        type: 'faction.resources',
        targetName: 'The Iron Company',
        previousValue: '40',
        newValue: '44',
      })?.text
    ).toBe('The Iron Company has grown wealthier.')
    // Same field, no values: the field layer's neutral line.
    expect(
      phraseWorldEvent({ type: 'faction.resources', targetName: 'The Iron Company' })?.text
    ).toBe("The Iron Company's fortunes shifted.")
  })

  it('falls back to a flat type line only when the field layer has none', () => {
    // jointScheme has no FIELD_LINES entry and no direction.
    expect(
      phraseWorldEvent({ type: 'npc.jointScheme', targetName: 'Elder Rowan' })?.text
    ).toContain('accomplice')
  })

  it('assumes nothing about the reader having been away', () => {
    // These lines are shared with the chronicle and the knowledge panel,
    // where "while you were away" would simply be false. #396's
    // warDeclared line said exactly that.
    for (const type of phrasedTypes()) {
      const text = phraseWorldEvent({ type, targetName: 'X' })?.text ?? ''
      expect(text, `${type} assumes an absence`).not.toMatch(/while you were away|you left it/)
    }
    for (const field of phrasedFields()) {
      const text = phraseWorldEvent({ type: `faction.${field}`, targetName: 'X' })?.text ?? ''
      expect(text, `${field} assumes an absence`).not.toMatch(/while you were away|you left it/)
    }
  })
})

describe('changeDirection', () => {
  it('reads a direction only from two real numbers', () => {
    expect(changeDirection('1', '2')).toBe('up')
    expect(changeDirection('2', '1')).toBe('down')
    expect(changeDirection('2', '2')).toBe('flat')
  })

  it('calls a non-numeric change unknown rather than flat', () => {
    // "stormy" -> "clear" genuinely changed. Reporting it as flat would
    // drop a real event, because callers treat flat as nothing happened.
    expect(changeDirection('stormy', 'clear')).toBe('unknown')
    expect(changeDirection(null, '3')).toBe('unknown')
    expect(changeDirection('3', undefined)).toBe('unknown')
  })
})

describe('vocabulary drift', () => {
  // Only the FIELD half is checked, not the full `targetType.field` key:
  // entityType and field are separate properties of an object literal the
  // handlers build, and pairing them from source text means guessing at a
  // window of characters. Field names alone are what actually drift — a
  // handler starting to write a new one is the case that matters.

  it('has an opinion about every field the simulation writes', () => {
    const unphrased = [...tickFieldNames()].filter((f) => !phrasedFieldNames().has(f)).sort()
    expect(
      unphrased,
      `tick handlers write these fields with no phrasing and no entry in SILENT_TYPES. ` +
        `Add a sentence to PHRASINGS, or add the type to SILENT_TYPES if players should not see it.`
    ).toEqual([])
  })

  it('has no type-layer phrasing for a field nothing writes any more', () => {
    const stale = [...typeLayerFieldNames()].filter((f) => !tickFieldNames().has(f)).sort()
    expect(stale, `phrasings for fields no tick handler writes — dead vocabulary`).toEqual([])
  })

  it('does not claim the field layer is free of dead entries', () => {
    // FIELD_LINES is deliberately NOT staleness-checked, and this test
    // records why rather than leaving the asymmetry unexplained.
    //
    // Field names do not all arrive from literals. The integrity engine
    // and consequence extraction write `field: repair.field`,
    // `change.field`, `claim.kind` and `f.key` — computed at runtime — so
    // a grep over tick sources cannot enumerate the real vocabulary. Four
    // of #396's lines (`founded`, `leader`, `leadership`, `status`) have
    // no literal writer anywhere in src/lib and may still be live through
    // one of those paths. Asserting they are dead would delete reviewed
    // player copy on the strength of a grep that is known to be partial.
    //
    // The forward direction above is the one that holds either way: a new
    // field with no sentence is caught, whichever layer ends up covering
    // it.
    const noLiteralWriter = ['founded', 'leader', 'leadership', 'status']
    for (const field of noLiteralWriter) {
      expect(phrasedFields(), `${field} should still be phrased`).toContain(field)
      expect(tickFieldNames().has(field), `${field} gained a literal writer — the stale check can now cover it`).toBe(false)
    }
  })
})
