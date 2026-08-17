// src/lib/tutorial/content/__tests__/noPlayerFacingSpoilers.test.ts
//
// The mechanical half of the rule stated in mechanics.ts's header.
//
// MythOS hides its machine deliberately and consistently: stress is fully
// hidden (not even a band), relationships are hidden because "a visible
// meter turns a relationship into a resource to farm", proficiency is
// banded, debts render as an obligation and "never as a ledger counter".
//
// Documentation is a hole in all of that. A help page publishing the rate
// standing moves at teaches players to farm standing just as effectively
// as a meter would — the harm arrives through prose instead of pixels,
// and none of the UI-level guards see it coming. So the same rule has to
// be enforced against the teaching copy, which is what this file does.
//
// These pin the RULE, not the current wording. New mechanics are covered
// automatically because every test walks the registry.

import { describe, it, expect } from 'vitest'
import { MECHANICS } from '../mechanics'
import { ORIENTATION_CARDS } from '../orientation'
import { WALKTHROUGH } from '../walkthrough'

/** Every string a player can actually read, with a label for failures. */
function playerFacingStrings(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = []

  for (const m of MECHANICS) {
    out.push({ where: `mechanic "${m.id}".term`, text: m.term })
    out.push({ where: `mechanic "${m.id}".short`, text: m.short })
    m.body.forEach((p, i) => out.push({ where: `mechanic "${m.id}".body[${i}]`, text: p }))
    m.aliases.forEach((a, i) => out.push({ where: `mechanic "${m.id}".aliases[${i}]`, text: a }))
  }

  for (const c of ORIENTATION_CARDS) {
    out.push({ where: `orientation "${c.id}".title`, text: c.title })
    c.body.forEach((p, i) => out.push({ where: `orientation "${c.id}".body[${i}]`, text: p }))
  }

  for (const s of WALKTHROUGH) {
    out.push({ where: `walkthrough "${s.id}".title`, text: s.title })
    out.push({ where: `walkthrough "${s.id}".lede`, text: s.lede })
  }

  return out
}

describe('teaching copy never names deliberately hidden state', () => {
  // Character.stress is hidden ENTIRELY — not even a band — because
  // showing it "would turn did I fail? into am I about to level up".
  // Naming it in help would hand back exactly what hiding it protects.
  it('never mentions stress', () => {
    const offenders = playerFacingStrings().filter(s => /\bstress(ed|es)?\b/i.test(s.text))
    expect(offenders.map(o => o.where)).toEqual([])
  })

  // Character.relationships is HIDDEN (#91, DECIDED). Diegetic phrasing
  // only — never the axes the model actually stores.
  it('never names a relationship axis', () => {
    const axes = /\b(affection|trust|respect|fear|loyalty)\s+(score|value|level|rating|meter)\b/i
    const offenders = playerFacingStrings().filter(s => axes.test(s.text))
    expect(offenders.map(o => o.where)).toEqual([])
  })

  // Faction.beliefVector and NPC.disposition are never exposed even to
  // the AI prompt. They must not appear in prose either.
  it('never names the private simulation fields', () => {
    const internals = /\b(beliefVector|belief vector|disposition score|gmNotes)\b/i
    const offenders = playerFacingStrings().filter(s => internals.test(s.text))
    expect(offenders.map(o => o.where)).toEqual([])
  })

  // Advertising that a corruption-only / secret branch exists is itself
  // the spoiler — isSecret and isShadow capabilities are meant to be
  // discovered, not listed.
  it('does not advertise secret or shadow content as a category', () => {
    const branch = /\b(secret|shadow)\s+(capabilit|branch|tree|unlock)/i
    const offenders = playerFacingStrings().filter(s => branch.test(s.text))
    expect(offenders.map(o => o.where)).toEqual([])
  })
})

describe('teaching copy never publishes thresholds, rates or caps', () => {
  // The strong form of the rule. "Reputations are earned slowly, and a
  // favour from a dying faction isn't worth much" teaches the truth.
  // "Standing shifts ±1 per scene, capped at ±2" is a spreadsheet, and
  // is precisely the farming guide that hiding the meter prevents.
  const FORBIDDEN: { name: string; pattern: RegExp }[] = [
    { name: 'a signed delta (±1, +2, -3)', pattern: /[±+]\s?\d+\b|(?<![\w-])-\d+\b/ },
    { name: 'a rate ("3 per scene")', pattern: /\b\d+\s*(per|each|every)\s+\w+/i },
    { name: 'an explicit cap', pattern: /\b(capped|caps|cap)\s+(at|to)\b/i },
    { name: 'a fraction or ratio (7/10, 72/100)', pattern: /\b\d+\s*\/\s*\d+\b/ },
    { name: 'a percentage', pattern: /\b\d+\s?%/ },
    { name: 'a numeric range (1-5, 0 to 100)', pattern: /\b\d+\s*(-|–|to)\s*\d+\b/ },
    { name: 'a threshold ("at least 3")', pattern: /\b(at least|more than|fewer than|under|over)\s+\d+\b/i },
  ]

  for (const { name, pattern } of FORBIDDEN) {
    it(`contains no ${name}`, () => {
      const offenders = playerFacingStrings()
        .filter(s => pattern.test(s.text))
        .map(o => `${o.where}: ${JSON.stringify(o.text)}`)
      expect(offenders).toEqual([])
    })
  }
})

describe('teaching copy never leaks the engine', () => {
  // Players do not know this is a PbtA game. They see per-campaign
  // labels, and telling them the system name teaches them a vocabulary
  // that appears nowhere in the product.
  it('never says PbtA or Powered by the Apocalypse', () => {
    const offenders = playerFacingStrings().filter(s =>
      /\b(pbta|powered by the apocalypse)\b/i.test(s.text)
    )
    expect(offenders.map(o => o.where)).toEqual([])
  })

  // Campaign.statLabels renames all five per campaign, so naming the
  // canonical keys describes a vocabulary most players never see. Matched
  // as whole words in a stat-ish context to avoid flagging ordinary
  // English ("keep your cool", "a hard turn").
  it('never names the canonical stat keys as stats', () => {
    const keys = /\b(cool|hard|hot|sharp|weird)\s*(\+|stat|score|rating)\b|\+\s?(cool|hard|hot|sharp|weird)\b/i
    const offenders = playerFacingStrings().filter(s => keys.test(s.text))
    expect(offenders.map(o => o.where)).toEqual([])
  })

  // The narration never mentions dice or moves; roll receipts are opt-in
  // and collapsed. Orientation is day-one copy and must not open with
  // machinery — the transparency panel is where that belongs, and only
  // for players who go looking.
  it('keeps dice out of the orientation entirely', () => {
    // Deliberately not matching a bare "die": people in this world
    // travel, fall out and die, and that sentence is the whole point of
    // the world-turn card. Matching the English verb rather than the
    // engine vocabulary is a false positive that would push the copy
    // into worse prose to satisfy a test.
    const dice = /\b(\d+d\d+|dice|roll(ed|s|ing)?)\b/i
    const offenders = ORIENTATION_CARDS.filter(c =>
      c.body.some(p => dice.test(p)) || dice.test(c.title)
    )
    expect(offenders.map(c => c.id)).toEqual([])
  })
})
