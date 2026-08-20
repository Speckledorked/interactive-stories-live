// scripts/__tests__/generatedFlowVerify.test.ts
//
// The manifest verifier's AST facts, tested in miniature. The load-bearing
// property throughout: comments are structurally invisible, because the regex
// predecessor needed a hand-rolled comment stripper after prose mentions of a
// column counted as participation in its flow.

import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { fileMentionsSymbol, fileHasPayloadKey, fileHasStringKey } from '../generatedFlowVerify'

function sf(code: string): ts.SourceFile {
  return ts.createSourceFile('/x.ts', code, ts.ScriptTarget.ES2020, true)
}

describe('fileMentionsSymbol', () => {
  it('sees identifiers, property names, and string literals', () => {
    expect(fileMentionsSymbol(sf('const advancementTrack = 1'), 'advancementTrack')).toBe(true)
    expect(fileMentionsSymbol(sf('x({ advancementTrack: 1 })'), 'advancementTrack')).toBe(true)
    expect(fileMentionsSymbol(sf(`select("advancementTrack")`), 'advancementTrack')).toBe(true)
    expect(fileMentionsSymbol(sf('const t = `has advancementTrack inside`'), 'advancementTrack')).toBe(true)
  })

  it('cannot see comments, by construction', () => {
    expect(fileMentionsSymbol(sf('// prose about advancementTrack\nconst x = 1'), 'advancementTrack')).toBe(false)
    expect(fileMentionsSymbol(sf('/* advancementTrack in a block */\nconst x = 1'), 'advancementTrack')).toBe(false)
  })
})

describe('fileHasPayloadKey / fileHasStringKey', () => {
  it('payload-key means an object-literal property, nothing else', () => {
    expect(fileHasPayloadKey(sf('x({ advancement_track: v })'), 'advancement_track')).toBe(true)
    expect(fileHasPayloadKey(sf('const advancement_track = v'), 'advancement_track')).toBe(false)
    expect(fileHasPayloadKey(sf('// { advancement_track: v }'), 'advancement_track')).toBe(false)
  })

  it('string-key means literal text, including template heads and spans', () => {
    expect(fileHasStringKey(sf(`const p = "report advancement_track here"`), 'advancement_track')).toBe(true)
    expect(fileHasStringKey(sf('const p = `report advancement_track ${x} y`'), 'advancement_track')).toBe(true)
    expect(fileHasStringKey(sf('const p = `a ${x} advancement_track tail`'), 'advancement_track')).toBe(true)
    expect(fileHasStringKey(sf('// advancement_track only in prose'), 'advancement_track')).toBe(false)
  })
})
