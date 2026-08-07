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

function makeTx() {
  return {
    character: { update: vi.fn(async (_args: any) => ({})) },
    location: { findUnique: vi.fn(async () => null) },
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
        fc.constantFrom<'id' | 'name' | 'garbage'>('id', 'name', 'garbage'),
        fc.integer({ min: -50, max: 50 }),
        async (roster, idShape, trustDelta) => {
          const target = roster[0]
          const entityId =
            idShape === 'id' ? target.id
            : idShape === 'name' ? target.name
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
            noTheme,
            true
          )

          const validIds = new Set(roster.map((n) => n.id))
          const call = tx.character.update.mock.calls[0]
          if (!call) return // nothing written is trivially fine — never an orphan key
          const relationships = (call[0] as any).data.relationships ?? {}
          for (const key of Object.keys(relationships)) {
            expect(validIds.has(key)).toBe(true)
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

type AliasShape = 'real-id' | 'exact-name' | 'case-variant-name' | 'typo-name' | 'placeholder-id'

/** How the AI might refer to `npc` — every one of these must resolve to it. */
function aliasFor(shape: AliasShape, npc: { id: string; name: string }): { entity_id: string; entity_name: string } {
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
            shape: fc.constantFrom<AliasShape>(
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
                  ...aliasFor(step.shape, npc),
                  ...step.deltas,
                  reason: 'round-trip property test',
                })),
              },
            }] as PcChange[],
            [character()],
            roster,
            noTheme,
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
