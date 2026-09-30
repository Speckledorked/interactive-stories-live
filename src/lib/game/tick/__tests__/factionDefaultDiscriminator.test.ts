// src/lib/game/tick/__tests__/factionDefaultDiscriminator.test.ts
//
// #510 — the FACTION_DEFAULT wake tag is NOT a write-only row.
//
// The audit that opened #510 listed `wakeSourceType: 'FACTION_DEFAULT'`
// among four "write-only event rows ... the rows are noise", on the
// evidence that nothing anywhere reads that value. That is true and it is
// exactly backwards: the tag is a NEGATIVE discriminator. Both classifiers
// that care match on 'NPC' | 'FACTION' and the tag's whole job is to be
// neither, so a row carrying it falls through.
//
// #310 is why it exists. economyTick's loan-default cascade writes a
// stability hit with origin 'wake', which is byte-for-byte the shape
// wakeTick writes for a genuine death-or-collapse ripple. Without the tag,
// `origin: 'wake'` alone made an ally stiffing you on a loan read as your
// own neighbourhood collapsing — beliefTick drifted toward
// COLLAPSE_RIPPLE_SURVIVED and npcDispositionTick toward
// FACTION_ABANDONED_THEM, for a faction that had simply been left out of
// pocket.
//
// Deleting the tag as dead weight would leave `wakeSourceType` null, which
// still fails both `=== 'NPC' | 'FACTION'` checks — so the cleanup would
// look harmless, pass every test, and quietly re-arm #310 the moment
// anyone widened a classifier to "any wake row". These tests make the
// intent executable: the tag must be written, and it must classify as
// nothing.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { classifyWorldEvent } from '../beliefTick'
import { classifyFactionEvent } from '../npcDispositionTick'

/** A stability hit delivered by the wake system, tagged as `source`. */
function wakeStabilityRow(source: string | null) {
  return {
    type: 'faction.stability',
    newValue: '40',
    previousValue: '50',
    origin: 'wake',
    wakeSourceType: source,
  }
}

describe('FACTION_DEFAULT is a deliberate negative discriminator', () => {
  it('reads as a collapse ripple when a member died or a faction fell', () => {
    // The control. Without these passing, the assertions below would hold
    // for a classifier that had simply stopped working.
    expect(classifyWorldEvent(wakeStabilityRow('NPC'))).toEqual({ kind: 'COLLAPSE_RIPPLE_SURVIVED' })
    expect(classifyWorldEvent(wakeStabilityRow('FACTION'))).toEqual({ kind: 'COLLAPSE_RIPPLE_SURVIVED' })
    expect(classifyFactionEvent(wakeStabilityRow('NPC'))).toEqual({ kind: 'FACTION_ABANDONED_THEM' })
    expect(classifyFactionEvent(wakeStabilityRow('FACTION'))).toEqual({ kind: 'FACTION_ABANDONED_THEM' })
  })

  it('reads as nothing at all when the hit came from a defaulted loan', () => {
    // A solvent faction whose ally stiffed it is not a faction watching its
    // own world come apart, and must not drift either belief or
    // disposition as though it were.
    expect(classifyWorldEvent(wakeStabilityRow('FACTION_DEFAULT'))).toBeNull()
    expect(classifyFactionEvent(wakeStabilityRow('FACTION_DEFAULT'))).toBeNull()
  })

  it('still writes the tag on the default cascade', () => {
    // The classifiers above would go on passing if economyTick stopped
    // emitting the tag — a null wakeSourceType falls through the same way.
    // That is the failure mode this asserts against: the tag is only a
    // discriminator while it is actually written, and #310 is a regression
    // away the moment a classifier is widened to "any wake row".
    const source = readFileSync(join(process.cwd(), 'src/lib/game/tick/economyTick.ts'), 'utf8')
    expect(source).toMatch(/wakeSourceType:\s*'FACTION_DEFAULT'/)
    expect(source).toMatch(/sourceType:\s*'FACTION_DEFAULT'/)
  })
})
