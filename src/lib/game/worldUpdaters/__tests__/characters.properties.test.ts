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

// The orphan-key property above says "never write a key nothing can
// resolve". That is necessary but not sufficient: it is satisfied by a
// writer that simply DROPS everything it can't recognize verbatim. The
// invariant the readers actually depend on is stronger — an NPC has ONE
// relationship record, and which of that NPC's several names the narrator
// happened to use this turn must not decide where the deltas land.
//
// So this is the round trip proper: write through an arbitrary alias, read
// back through the canonical id. Every alias below is one
// resolveEntityByNameOrId already resolves today (exact id, exact name,
// case variance, whitespace variance, and the single-character typo its
// confidence gate exists to absorb), so a correct writer must funnel all of
// them onto the same key and SUM the deltas there.
//
// The Phase 0 bug fails this even when it happens to avoid an orphan key:
// reporting Kessler once by id and once by "Lord Kessler" splits one
// relationship into two half-histories, and the roll-time reader — which
// only ever looks up the real NPC id — silently sees whichever half the
// narrator's last phrasing landed in.
type AliasKind = 'id' | 'name' | 'upper' | 'padded' | 'typo'

function aliasFor(npc: { id: string; name: string }, kind: AliasKind): string {
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

const clampTo100 = (n: number) => Math.max(-100, Math.min(100, n))

describe('applyCharacterChanges — relationship alias round-trip (property)', () => {
  it('for any mix of aliases naming one NPC, the deltas merge onto that NPC\'s canonical id', async () => {
    await fc.assert(
      fc.asyncProperty(
        npcRosterArb,
        fc.nat(),
        fc.array(
          fc.record({
            alias: fc.constantFrom<AliasKind>('id', 'name', 'upper', 'padded', 'typo'),
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
                  entity_id: aliasFor(target, r.alias),
                  entity_name: target.name,
                  trust_delta: r.trustDelta,
                  reason: 'alias round-trip property',
                })),
              },
            }] as PcChange[],
            [character()],
            roster,
            noTheme,
            true
          )

          const call = tx.character.update.mock.calls[0]
          expect(call).toBeDefined() // every alias here resolves, so this must land
          const relationships = (call![0] as any).data.relationships ?? {}

          // One NPC named five ways is still one relationship.
          expect(Object.keys(relationships)).toEqual([target.id])
          // ...carrying every delta, clamped the same way the writer clamps
          // it: per change against the running value, not once on the sum.
          const expectedTrust = reports.reduce((acc, r) => clampTo100(acc + r.trustDelta), 0)
          expect(relationships[target.id].trust).toBe(expectedTrust)
        }
      ),
      { numRuns: 200 }
    )
  })
})
