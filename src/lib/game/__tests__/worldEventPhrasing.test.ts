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

/** The field half of every type this module has an opinion about. */
function phrasedFieldNames(): Set<string> {
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
    expect(phrased?.text).toContain('declared war')
    expect(phrased?.kind).toBe('war')
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

  it('has no phrasing for a field nothing writes any more', () => {
    const stale = [...phrasedFieldNames()].filter((f) => !tickFieldNames().has(f)).sort()
    expect(stale, `phrasings for fields no tick handler writes — dead vocabulary`).toEqual([])
  })
})
