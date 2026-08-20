// src/lib/game/worldUpdaters/__tests__/characters.properties.test.ts
//
// The Phase 0 relationship-orphan bug (see integrity/ plan doc) passed
// every example-based test in characters.test.ts because those tests
// supplied a valid entity_id and asserted that same id came back — a
// property that's tautological with respect to the actual bug. Nobody had
// to imagine "npc_123" until it showed up in production.
//
// This file states the REAL invariant as a property instead of an example:
// for ANY entity_id the AI could plausibly emit (its real id, its real
// name, or a garbage placeholder), the write either lands under a real
// NPC's id or doesn't land at all — Character.relationships must never end
// up with a key nothing can resolve, because every reader (resolution.ts's
// roll lookup, socialTies.ts, questFailure.ts) looks it up by real id.
// fast-check finds the counterexample on its own; nobody has to enumerate
// the shapes an LLM might produce.
//
// The describe blocks below this one go further, added after several
// independent runs of the integrity-autofix pipeline against this same
// checkKey each surfaced a different facet of the invariant the orphan-key
// property alone doesn't state: a round trip through the real roll-time
// reader (not just "some real id"), multiple aliases for one NPC arriving
// in a single batch collapsing onto one key, and the same NPC being named
// inconsistently turn over turn still converging on one key rather than
// fragmenting.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import { applyCharacterChanges, PcChange } from '../characters'
import { relationshipModifier } from '../../resolution'
import { clamp } from '../../tick/types'
import type { Character } from '@prisma/client'

vi.mock('../../debts', () => ({ applyDebtChanges: vi.fn(async () => []) }))
vi.mock('../../standing', () => ({ applyStandingChanges: vi.fn(async () => []) }))
vi.mock('../../capabilities', () => ({ applyCapabilityChanges: vi.fn(async () => []) }))
vi.mock('../locations', () => ({ resolveOrCreateLocationId: vi.fn(async () => null) }))

const noTheme = vi.fn().mockResolvedValue(null)
// Campaigns in these fixtures have no rank ladder; the advancement_tier
// channel is inert for them, exactly as it is for a real such campaign.
const noTrack = vi.fn().mockResolvedValue(null)

function makeTx() {
  return {
    character: { update: vi.fn(async (_args: any) => ({})) },
    location: { findUnique: vi.fn(async () => null) },
    stateMutation: { create: vi.fn(async (_args: any) => ({})) },
  }
}

// Matches characters.test.ts's helper shape (Partial<Character> spread)
// exactly — the spread is what lets `as Character` type-check, since a
// bare 12-field literal doesn't overlap enough with the full model.
const character = (over: Partial<Character> = {}): Character =>
  ({
    id: 'char1', name: 'Jason', harm: 0, conditions: null,
    equipment: {}, inventory: { items: [] },
    relationships: null, consequences: null,
    appearance: null, personality: null, resources: null,
    corruption: 0,
    ...over,
  } as Character)

// A small, realistic NPC roster the AI could be describing.
const npcRosterArb = fc.uniqueArray(
  fc.record({
    id: fc.stringMatching(/^npc[0-9]{1,3}$/),
    name: fc.constantFrom('Lord Kessler', 'Vashti', 'Guard Captain', 'The Ledger-Keeper'),
  }),
  { minLength: 1, maxLength: 4, selector: (n) => n.id }
).filter((roster) => new Set(roster.map((n) => n.name)).size === roster.length) // no duplicate names in one roster

beforeEach(() => vi.clearAllMocks())

describe('applyCharacterChanges — relationship key resolution (property)', () => {
  it('for any entity_id shape the AI could emit, every written relationships key resolves to a real NPC id', async () => {
    await fc.assert(
      fc.asyncProperty(
        npcRosterArb,
        fc.constantFrom<'id' | 'name' | 'name-with-whitespace' | 'garbage'>('id', 'name', 'name-with-whitespace', 'garbage'),
        fc.integer({ min: -50, max: 50 }),
        async (roster, idShape, trustDelta) => {
          const target = roster[0]
          const entityId =
            idShape === 'id' ? target.id
            : idShape === 'name' ? target.name
            // resolveEntityByNameOrId normalizes case/whitespace before
            // comparing names — this shape is the one that would have
            // caught worldUpdaters/characters.ts writing relChange.entity_id
            // straight into Character.relationships instead of resolving
            // it first.
            : idShape === 'name-with-whitespace' ? `  ${target.name.toUpperCase()}  `
            : 'npc_123'

          const tx = makeTx()
          await applyCharacterChanges(
            tx as any,
            'camp1',
            1,
            [{
              character_name_or_id: 'char1',
              changes: {
                relationship_changes: [{
                  entity_id: entityId,
                  entity_name: target.name,
                  trust_delta: trustDelta,
                  reason: 'property test',
                }],
              },
            }] as PcChange[],
            [character()],
            roster,
            noTheme, noTrack,
            true
          )

          const validIds = new Set(roster.map((n) => n.id))
          const call = tx.character.update.mock.calls[0]
          if (!call) return // nothing written is trivially fine — never an orphan key
          const relationships = (call[0] as any).data.relationships ?? {}
          for (const key of Object.keys(relationships)) {
            expect(validIds.has(key)).toBe(true)
          }
          // Not just "some real id" — the reported name/garbage must resolve
          // to the SPECIFIC NPC it named. A raw, unresolved entity_id fails
          // this the same way it fails the "some real id" check above (the
          // idShape === 'garbage' case never lands under target.id at all),
          // which is exactly the recurring production violation this file
          // exists to catch (checkKey character.relationships.keys.resolve,
          // campaign cms40seuh0001ilf6nqree1ru — Tre Coleman's relationships
          // map picked up orphaned keys from this same unresolved-entity_id
          // shape).
          if (idShape !== 'garbage') {
            expect(relationships[target.id]).toBeDefined()
          }
        }
      ),
      { numRuns: 200 }
    )
  })
})

// The orphan-key property above states the SAFETY half of the invariant:
// nothing unresolvable is ever written. That alone is satisfiable by an
// applier that writes nothing at all, and it says nothing about the half
// production actually noticed — the rapport the fiction earned has to still
// be there at roll time, under the id the roll looks it up by.
//
// So this states the LIVENESS half as a round trip through the real reader:
//   write(any alias the AI could use for an NPC)
//     -> Character.relationships
//       -> read by that NPC's real id (resolution.ts:891)
//         -> relationshipModifier
// must land the accumulated deltas exactly, for EVERY alias shape — the
// real id, the exact name, a case variant, a one-character typo, and the
// prompt's own placeholder id carried alongside a correct entity_name
// (which is the shape that actually reached production: "npc_123").
//
// The two aliases-in-one-batch case is the part no example test had: two
// changes naming the same NPC by different aliases must collapse onto ONE
// key. A "fix" that keyed by whatever string arrived would split one
// relationship into two half-counted ones and still never write an orphan.

type RoundTripAliasShape = 'real-id' | 'exact-name' | 'case-variant-name' | 'typo-name' | 'placeholder-id'

/** How the AI might refer to `npc` — every one of these must resolve to it. */
function aliasForRoundTrip(shape: RoundTripAliasShape, npc: { id: string; name: string }): { entity_id: string; entity_name: string } {
  switch (shape) {
    case 'real-id':
      return { entity_id: npc.id, entity_name: npc.name }
    case 'exact-name':
      return { entity_id: npc.name, entity_name: npc.name }
    case 'case-variant-name':
      return { entity_id: npc.name.toUpperCase(), entity_name: npc.name }
    // A single dropped trailing character — inside resolveEntityByNameOrId's
    // confident-fuzzy gate for every name in the roster arbitrary, and
    // nowhere near any OTHER name in it, so the intended NPC is the only
    // match rather than an ambiguous one.
    case 'typo-name':
      return { entity_id: npc.name.slice(0, -1), entity_name: npc.name }
    // The prompt's own example id, with the name reported correctly.
    case 'placeholder-id':
      return { entity_id: 'npc_123', entity_name: npc.name }
  }
}

const RAPPORT_ZERO = { trust: 0, tension: 0, respect: 0, fear: 0 }

const deltaArb = fc.record({
  trust_delta: fc.integer({ min: -70, max: 70 }),
  tension_delta: fc.integer({ min: -70, max: 70 }),
  respect_delta: fc.integer({ min: -70, max: 70 }),
  fear_delta: fc.integer({ min: -70, max: 70 }),
})

describe('applyCharacterChanges — relationship round trip (property)', () => {
  it('for any alias the AI could use, the rapport written is the rapport the roll reads back under the real NPC id', async () => {
    await fc.assert(
      fc.asyncProperty(
        npcRosterArb,
        fc.nat(),
        fc.array(
          fc.record({
            shape: fc.constantFrom<RoundTripAliasShape>(
              'real-id', 'exact-name', 'case-variant-name', 'typo-name', 'placeholder-id'
            ),
            deltas: deltaArb,
          }),
          { minLength: 1, maxLength: 3 }
        ),
        async (roster, targetPick, steps) => {
          const npc = roster[targetPick % roster.length]

          const tx = makeTx()
          await applyCharacterChanges(
            tx as any,
            'camp1',
            1,
            [{
              character_name_or_id: 'char1',
              changes: {
                relationship_changes: steps.map((step) => ({
                  ...aliasForRoundTrip(step.shape, npc),
                  ...step.deltas,
                  reason: 'round-trip property test',
                })),
              },
            }] as PcChange[],
            [character()],
            roster,
            noTheme, noTrack,
            true
          )

          // The same per-change clamping the applier does, in the same order.
          const expected = steps.reduce((rapport, step) => ({
            trust: clamp(rapport.trust + step.deltas.trust_delta, -100, 100),
            tension: clamp(rapport.tension + step.deltas.tension_delta, -100, 100),
            respect: clamp(rapport.respect + step.deltas.respect_delta, -100, 100),
            fear: clamp(rapport.fear + step.deltas.fear_delta, -100, 100),
          }), RAPPORT_ZERO)

          const call = tx.character.update.mock.calls[0]
          expect(call, 'rapport the fiction earned must be written at all').toBeTruthy()
          const relationships = (call![0] as any).data.relationships

          // Exactly one entry, keyed by the real NPC id — however many
          // different aliases named them.
          expect(Object.keys(relationships)).toEqual([npc.id])
          expect(relationships[npc.id]).toEqual(expected)

          // And the roll-time reader, which only ever looks up by real id,
          // gets the modifier those deltas earned rather than a silent 0.
          const atRollTime = relationships[npc.id]
          expect(relationshipModifier({ npcName: npc.name, ...atRollTime })).toBe(
            relationshipModifier({ npcName: npc.name, ...expected })
          )
        }
      ),
      { numRuns: 200 }
    )
  })
})

// The orphan-key property says "never write a key nothing can resolve".
// That is necessary but not sufficient: it is satisfied by a writer that
// simply DROPS everything it can't recognize verbatim. The invariant the
// readers actually depend on is stronger — an NPC has ONE relationship
// record, and which of that NPC's several names the narrator happened to
// use this turn must not decide where the deltas land.
//
// So this is a second round trip, over a different alias vocabulary than
// the one above (whitespace-padding instead of a placeholder id) and
// asserting the merge on trust specifically rather than the full rapport
// vector: write through an arbitrary alias, read back through the
// canonical id. Every alias below is one resolveEntityByNameOrId already
// resolves today (exact id, exact name, case variance, whitespace
// variance, and the single-character typo its confidence gate exists to
// absorb), so a correct writer must funnel all of them onto the same key
// and SUM the deltas there.
type MergeAliasKind = 'id' | 'name' | 'upper' | 'padded' | 'typo'

function aliasForMerge(npc: { id: string; name: string }, kind: MergeAliasKind): string {
  switch (kind) {
    case 'id': return npc.id
    case 'name': return npc.name
    case 'upper': return npc.name.toUpperCase()
    case 'padded': return `  ${npc.name}  `
    // One inserted character: edit distance 1 over a name of at least 6
    // characters, so it clears MAX_EDIT_RATIO, and it is nowhere near any
    // other name in the roster — a unique confident match, never ambiguous.
    case 'typo': return npc.name[0] + npc.name
  }
}

describe('applyCharacterChanges — relationship alias round-trip (property)', () => {
  it('for any mix of aliases naming one NPC, the deltas merge onto that NPC\'s canonical id', async () => {
    await fc.assert(
      fc.asyncProperty(
        npcRosterArb,
        fc.nat(),
        fc.array(
          fc.record({
            alias: fc.constantFrom<MergeAliasKind>('id', 'name', 'upper', 'padded', 'typo'),
            trustDelta: fc.integer({ min: -60, max: 60 }),
          }),
          { minLength: 2, maxLength: 5 }
        ),
        async (roster, targetPick, reports) => {
          const target = roster[targetPick % roster.length]

          const tx = makeTx()
          await applyCharacterChanges(
            tx as any,
            'camp1',
            1,
            [{
              character_name_or_id: 'char1',
              changes: {
                relationship_changes: reports.map((r) => ({
                  entity_id: aliasForMerge(target, r.alias),
                  entity_name: target.name,
                  trust_delta: r.trustDelta,
                  reason: 'alias round-trip property',
                })),
              },
            }] as PcChange[],
            [character()],
            roster,
            noTheme, noTrack,
            true
          )

          const call = tx.character.update.mock.calls[0]
          expect(call).toBeDefined() // every alias here resolves, so this must land
          const relationships = (call![0] as any).data.relationships ?? {}

          // One NPC named five ways is still one relationship.
          expect(Object.keys(relationships)).toEqual([target.id])
          // ...carrying every delta, clamped the same way the writer clamps
          // it: per change against the running value, not once on the sum.
          const expectedTrust = reports.reduce((acc, r) => clamp(acc + r.trustDelta, -100, 100), 0)
          expect(relationships[target.id].trust).toBe(expectedTrust)
        }
      ),
      { numRuns: 200 }
    )
  })
})

// The production evidence for this checkKey wasn't a single bad write — it
// was the SAME NPC accruing orphan keys across several turns (Tre Coleman,
// turns 10/43/46/52), because the AI doesn't consistently echo the same
// entity_id shape scene to scene: one turn it reports the real id, the next
// it reports the name. A round trip across turns must converge on the one
// real NPC id no matter which shape arrived when, with deltas accumulating
// onto that single key — not fragmenting into a second, unreadable key the
// moment the AI's phrasing changes.
describe('applyCharacterChanges — relationship convergence across turns (property)', () => {
  it('accumulates trust deltas for the same NPC onto a single key across turns, however entity_id is shaped turn to turn', async () => {
    await fc.assert(
      fc.asyncProperty(
        npcRosterArb,
        fc.array(
          fc.record({
            idShape: fc.constantFrom<'id' | 'name'>('id', 'name'),
            trustDelta: fc.integer({ min: -20, max: 20 }),
          }),
          { minLength: 2, maxLength: 6 }
        ),
        async (roster, turns) => {
          const target = roster[0]
          let workingCharacter = character()
          let expectedTrust = 0

          for (const turn of turns) {
            const entityId = turn.idShape === 'id' ? target.id : target.name
            const tx = makeTx()
            await applyCharacterChanges(
              tx as any,
              'camp1',
              1,
              [{
                character_name_or_id: 'char1',
                changes: {
                  relationship_changes: [{
                    entity_id: entityId,
                    entity_name: target.name,
                    trust_delta: turn.trustDelta,
                    reason: 'convergence property test',
                  }],
                },
              }] as PcChange[],
              [workingCharacter],
              roster,
              noTheme, noTrack,
              true
            )

            expectedTrust = clamp(expectedTrust + turn.trustDelta, -100, 100)

            const call = tx.character.update.mock.calls[0]
            if (call) {
              workingCharacter = { ...workingCharacter, relationships: (call[0] as any).data.relationships }
            }
          }

          const relationships = (workingCharacter.relationships as any) ?? {}
          const keys = Object.keys(relationships)

          // Every turn named the same real NPC (by id or by name) — the
          // fiction never introduced a second entity, so the map must never
          // grow a second key for it.
          expect(keys.length).toBe(1)
          expect(keys[0]).toBe(target.id)
          expect(relationships[target.id].trust).toBe(expectedTrust)
        }
      ),
      { numRuns: 200 }
    )
  })
})
