// src/__tests__/loggingModels.test.ts
//
// The "don't add a fifth" half of #86.
//
// Four models record what happened in a campaign — CampaignLog,
// TimelineEvent, WorldEvent and CampaignMemory — and the README's standing
// decision is to LEAVE them alone: each has a real reason to exist, and
// consolidating them is a refactor with genuine regression risk for no
// user-visible gain. That decision holds up on inspection:
//
//   - TimelineEvent carries fog of war (visibility, separate public and GM
//     summaries). CampaignLog has no notion of it.
//   - CampaignLog carries in-game time and highlights. TimelineEvent has
//     neither.
//   - WorldEvent isn't a prose log at all — it's a structured diff stream
//     (field/previousValue/newValue) with two deterministic readers (#79).
//   - CampaignMemory is vector-embedded for RAG and written by raw SQL.
//
// A single model covering all four would need fog-of-war visibility AND
// in-game duration AND embeddings AND machine-readable typed diffs. That's
// a union type across four access patterns, which is usually worse than
// four focused tables.
//
// What that entry ALSO says is "worth a design pass before a fifth is
// added" — and nothing enforced it. A fifth would simply appear, which is
// exactly how there came to be four. This is that enforcement: the
// decision to keep them separate is deliberate, so the set is pinned.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const schema = readFileSync('prisma/schema.prisma', 'utf8')

/** Every `model X { ... }` block, as name → body. */
function models(): Array<{ name: string; fields: Set<string> }> {
  const out: Array<{ name: string; fields: Set<string> }> = []
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const fields = new Set(
      [...match[2].matchAll(/^\s{2}(\w+)\s/gm)].map(m => m[1])
    )
    out.push({ name: match[1], fields })
  }
  return out
}

const has = (fields: Set<string>, names: string[]) => names.some(n => fields.has(n))

/**
 * A record of something that happened, in either shape this codebase uses:
 * prose ("here is what occurred") or a structured diff ("this field moved
 * from X to Y"). Both are pinned, because a fifth of either kind is the
 * thing worth pausing over.
 */
function isWhatHappenedModel(fields: Set<string>): boolean {
  const temporal = has(fields, ['turnNumber', 'sessionDate', 'occurredAt'])
  if (!temporal) return false

  const prose = has(fields, ['summary', 'summaryPublic', 'content', 'description', 'title'])
  const structuredDiff = has(fields, ['previousValue']) && has(fields, ['newValue'])
  return prose || structuredDiff
}

/**
 * The four, and why each earns its place. A name here is a claim that this
 * model is distinct from the other three — if a fifth is added, the right
 * response is a design pass, not another entry.
 */
const KNOWN: Record<string, string> = {
  CampaignLog:
    'the player-facing chronicle: per-scene prose with in-game date, duration and highlights. No fog of war.',
  TimelineEvent:
    'the fog-of-war timeline: PUBLIC/MIXED/GM visibility with separate public and GM summaries, plus onscreen-vs-offscreen. Feeds the away-recap.',
  WorldEvent:
    'the structured diff stream the simulation reads back — field/previousValue/newValue, typed and filterable. Two deterministic readers (#79 crisis targeting and goal commitment). Not prose.',
  CampaignMemory:
    'RAG: pgvector-embedded and written by raw SQL, retrieved by cosine similarity rather than queried by turn.',
}

describe('the four what-happened models (#86)', () => {
  const detected = models().filter(m => isWhatHappenedModel(m.fields)).map(m => m.name)

  it('detects the ones we know about, so the check is not vacuous', () => {
    // Guards the heuristic itself. If a schema refactor broke the field
    // patterns, every case below would pass by examining nothing.
    expect(detected).toEqual(expect.arrayContaining(Object.keys(KNOWN)))
  })

  it('has not grown a fifth', () => {
    // The enforcement the README asks for and could not previously get.
    // A new one is not necessarily wrong — but it should be a decision,
    // taken with the other four in view, rather than a fifth parallel
    // stream that appears because nobody was counting.
    const unexpected = detected.filter(name => !(name in KNOWN))

    expect(
      unexpected,
      `New "what happened" model(s) in schema.prisma:\n  ${unexpected.join('\n  ')}\n\n` +
      `There are already four (${Object.keys(KNOWN).join(', ')}), and #86 says a ` +
      `fifth is worth a design pass first. If it genuinely belongs, add it to ` +
      `KNOWN in this file with what makes it distinct from the other four — ` +
      `writing that sentence is the design pass.`
    ).toEqual([])
  })

  it('does not carry entries for models that no longer exist', () => {
    // Self-pruning, like the README symbol allowlist and the fog-of-war
    // exemptions: a stale name would silently excuse a future model that
    // happened to reuse it.
    const missing = Object.keys(KNOWN).filter(name => !detected.includes(name))
    expect(missing, `Stale KNOWN entries:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('says what makes each one distinct', () => {
    for (const [name, reason] of Object.entries(KNOWN)) {
      expect(reason.length, `${name} needs a real reason, not a placeholder`).toBeGreaterThan(40)
    }
  })

  it('keeps fog of war on the timeline and off the chronicle', () => {
    // The specific distinction that makes these two not duplicates, and the
    // one most likely to be eroded by someone "unifying" them: only
    // TimelineEvent knows the difference between what players may read and
    // what the host may.
    const byName = Object.fromEntries(models().map(m => [m.name, m.fields]))
    expect(has(byName.TimelineEvent, ['visibility', 'summaryGM'])).toBe(true)
    expect(has(byName.CampaignLog, ['visibility', 'summaryGM'])).toBe(false)
  })
})
