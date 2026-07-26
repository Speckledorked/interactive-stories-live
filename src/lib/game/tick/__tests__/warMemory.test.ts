// src/lib/game/tick/__tests__/warMemory.test.ts
//
// The world remembers its own wars (#79).
//
// `War.resolvedTurn` and `War.outcome` have been recorded since wars
// existed and **nothing ever read them**. The whole tick was memoryless:
// `factionIdsAtWar` excluded only ACTIVE wars, so the tick after one
// resolved the same pair could declare another over the same location, and
// the tick after that, forever. Two factions with contested ground and
// standing armies would simply fight for the rest of the campaign.
//
// The fix is history as a real decision input, and specifically the OUTCOME
// as an input — not a flat cooldown. A faction that was beaten waits about
// twice as long as one that won, which is the difference between the world
// remembering *that* something happened and remembering *what* happened.

import { describe, it, expect } from 'vitest'
import {
  decideWarDeclaration,
  warExhaustionRemaining,
  WAR_EXHAUSTION_TURNS,
  WAR_DEFEAT_EXHAUSTION_TURNS,
  type ResolvedWar,
} from '../warTick'

const war = (over: Partial<ResolvedWar> = {}): ResolvedWar => ({
  attackerFactionId: 'a',
  defenderFactionId: 'b',
  resolvedTurn: 10,
  outcome: 'stalemate',
  ...over,
})

describe('warExhaustionRemaining', () => {
  it('is zero for two factions that have never fought', () => {
    expect(warExhaustionRemaining([], 'a', 'b', 20)).toBe(0)
    expect(warExhaustionRemaining([war({ attackerFactionId: 'x', defenderFactionId: 'y' })], 'a', 'b', 11)).toBe(0)
  })

  it('holds a pair apart immediately after a war', () => {
    expect(warExhaustionRemaining([war()], 'a', 'b', 11)).toBeGreaterThan(0)
  })

  it('makes the loser wait longer than the winner', () => {
    // The half that makes this history rather than a cooldown.
    const decisive = [war({ outcome: 'attacker' })]
    const loserWait = warExhaustionRemaining(decisive, 'b', 'a', 11)  // 'b' lost
    const winnerWait = warExhaustionRemaining(decisive, 'a', 'b', 11) // 'a' won
    expect(loserWait).toBeGreaterThan(winnerWait)
    expect(WAR_DEFEAT_EXHAUSTION_TURNS).toBeGreaterThan(WAR_EXHAUSTION_TURNS)
  })

  it('treats a stalemate as having no loser', () => {
    const drawn = [war({ outcome: 'stalemate' })]
    expect(warExhaustionRemaining(drawn, 'a', 'b', 11)).toBe(warExhaustionRemaining(drawn, 'b', 'a', 11))
  })

  it('knows the loser regardless of which side they were on', () => {
    // outcome names the WAR's attacker/defender, not the faction now
    // contemplating an attack — easy to get backwards.
    const defenderWon = [war({ attackerFactionId: 'a', defenderFactionId: 'b', outcome: 'defender' })]
    expect(warExhaustionRemaining(defenderWon, 'a', 'b', 11)).toBe(WAR_DEFEAT_EXHAUSTION_TURNS - 1)
    expect(warExhaustionRemaining(defenderWon, 'b', 'a', 11)).toBe(WAR_EXHAUSTION_TURNS - 1)
  })

  it('wears off, so peace is not permanent either', () => {
    // A world that could never fight the same war twice would be as
    // memoryless as one that always did.
    expect(warExhaustionRemaining([war()], 'a', 'b', 10 + WAR_EXHAUSTION_TURNS)).toBe(0)
    expect(warExhaustionRemaining([war()], 'a', 'b', 500)).toBe(0)
  })

  it('counts from the most recent war, not the first', () => {
    const history = [war({ resolvedTurn: 2 }), war({ resolvedTurn: 30 })]
    expect(warExhaustionRemaining(history, 'a', 'b', 31)).toBe(WAR_EXHAUSTION_TURNS - 1)
  })

  it('ignores a war that has not actually resolved', () => {
    expect(warExhaustionRemaining([war({ resolvedTurn: null })], 'a', 'b', 11)).toBe(0)
  })

  it('does not block a pair forever on corrupt turn data', () => {
    // A resolvedTurn ahead of the current turn is bad data, not a war in
    // the future. Blocking indefinitely would be the worse failure.
    expect(warExhaustionRemaining([war({ resolvedTurn: 999 })], 'a', 'b', 11)).toBe(0)
    expect(warExhaustionRemaining([war({ resolvedTurn: NaN })], 'a', 'b', 11)).toBe(0)
  })

  it('survives malformed history rather than throwing', () => {
    expect(warExhaustionRemaining(null as never, 'a', 'b', 11)).toBe(0)
    expect(warExhaustionRemaining([null as never], 'a', 'b', 11)).toBe(0)
  })
})

describe('decideWarDeclaration — with the world remembering', () => {
  const strong = { military: 90 }
  const attacker = { id: 'a', ...strong }
  const defender = { id: 'b', ...strong }
  const prize = [{ id: 'loc1', ownerFactionId: 'b', isContested: true }]

  it('still declares a first war between fresh rivals', () => {
    const d = decideWarDeclaration(attacker, defender, prize, { priorWars: [], currentTurn: 5 })
    expect(d).toMatchObject({ shouldDeclare: true, contestedLocationId: 'loc1' })
  })

  it('refuses a rematch the tick after the last war ended', () => {
    // The actual bug: perpetual war between the same pair.
    const d = decideWarDeclaration(attacker, defender, prize, {
      priorWars: [war({ resolvedTurn: 10 })],
      currentTurn: 11,
    })
    expect(d.shouldDeclare).toBe(false)
    expect(d.exhaustionRemaining).toBeGreaterThan(0)
  })

  it('allows the rematch once the weariness has passed', () => {
    const d = decideWarDeclaration(attacker, defender, prize, {
      priorWars: [war({ resolvedTurn: 10 })],
      currentTurn: 10 + WAR_EXHAUSTION_TURNS,
    })
    expect(d.shouldDeclare).toBe(true)
  })

  it('keeps the beaten side out of it for longer than the victor', () => {
    const priorWars = [war({ attackerFactionId: 'a', defenderFactionId: 'b', outcome: 'attacker', resolvedTurn: 10 })]
    const midway = 10 + WAR_EXHAUSTION_TURNS + 1

    // The winner may go again...
    expect(decideWarDeclaration(attacker, defender, prize, { priorWars, currentTurn: midway }).shouldDeclare).toBe(true)
    // ...the faction it beat may not.
    const revenge = decideWarDeclaration(
      { id: 'b', ...strong },
      { id: 'a', ...strong },
      [{ id: 'loc2', ownerFactionId: 'a', isContested: true }],
      { priorWars, currentTurn: midway }
    )
    expect(revenge.shouldDeclare).toBe(false)
  })

  it('does not let war-weariness override the military floor', () => {
    // Order of checks: too weak is still too weak, and reporting
    // exhaustion for a faction that could never have declared anyway
    // would make the tick log lie about why.
    const d = decideWarDeclaration({ id: 'a', military: 1 }, defender, prize, {
      priorWars: [war({ resolvedTurn: 10 })],
      currentTurn: 11,
    })
    expect(d.shouldDeclare).toBe(false)
    expect(d.exhaustionRemaining).toBeUndefined()
  })

  it('behaves exactly as before when handed no history', () => {
    // What makes the parameter safe to add: a caller without history in
    // hand gets the old behaviour rather than a silent new restriction.
    expect(decideWarDeclaration(attacker, defender, prize).shouldDeclare).toBe(true)
    expect(decideWarDeclaration(attacker, defender, prize, {}).shouldDeclare).toBe(true)
  })

  it('remembers a war fought over a different prize', () => {
    // Weariness is between the FACTIONS, not about the specific location —
    // otherwise a pair could rotate through contested locations and fight
    // continuously anyway.
    const d = decideWarDeclaration(
      attacker, defender,
      [{ id: 'somewhere-else', ownerFactionId: 'b', isContested: true }],
      { priorWars: [war({ resolvedTurn: 10 })], currentTurn: 11 }
    )
    expect(d.shouldDeclare).toBe(false)
  })
})
