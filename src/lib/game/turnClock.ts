// src/lib/game/turnClock.ts
//
// #437: the two clocks, made distinguishable to the type system.
//
// #374 established that this codebase has two counters both called "the
// turn number" and both stored as `Int`:
//
//   WorldMeta.simulationTurn     — how many WORLD TURNS have run. Advances
//                                  on the background simulation's schedule,
//                                  whether or not anyone is playing.
//   WorldMeta.currentTurnNumber  — how many PLAYER SCENES have resolved.
//                                  Advances only when a scene resolves.
//
// Neither dominates the other. A campaign that has ticked more than it has
// been played runs ahead on the sim clock; a campaign played hard between
// two world turns runs ahead on the scene clock. Subtracting one from the
// other is meaningless in both directions, and it produced a war the AI GM
// was told had been running for a NEGATIVE number of turns.
//
// #374 added the second clock and fixed the handlers it knew about. It did
// not — could not — audit every consumer, because both clocks are `number`
// and nothing could tell a crossing from a correct comparison. Seven sites
// were still crossing them when the v3 audit looked. Fixing those seven
// leaves the eighth to be written next week, so the fix is the type, not
// the seven lines.
//
// ## The rule
//
// **Every persisted turn column in this schema is on the SIMULATION clock.**
//
// The scene counter stays in WorldMeta.currentTurnNumber and in the two
// places that are genuinely about scenes — Scene.sceneNumber ordering and
// advancement.ts's arc gating (CharacterCapability.arcStartTurn), both of
// which count player exchanges by definition and never meet a sim-clock
// value. Everything that lands in a shared history table — WorldEvent,
// EventWitness, CampaignMemory, TimelineEvent, War, CampaignLog — is
// stamped on the simulation clock, by every writer, including the ones
// reached from scene resolution. Several scenes resolving between two world
// turns all legitimately happened "during" the same simulation turn.
//
// That rule is not new. #374 wrote it for WorldEvent and stateUpdater
// already calls currentSimulationTurn() to honour it. What is new is that
// the other five columns now follow it too, and that a violation is a
// compile error rather than a silently negative number in a prompt.
//
// ## Why branding works here
//
// `SimTurn` and `SceneTurn` are `number` at runtime — zero cost, and both
// still assign freely INTO a plain `number` (so Prisma's generated `data:`
// types accept them unchanged). What they block is the other direction: a
// plain `number`, or a `SceneTurn`, cannot be passed where a `SimTurn` is
// expected. So a function that stamps or compares a persisted turn column
// declares `SimTurn`, and every caller has to say — in greppable, reviewable
// source — where its value came from.
//
// Aliasing does not defeat this the way a name-based guard would be
// defeated: `const currentTurn = worldMeta.currentTurnNumber` infers
// SceneTurn, and stays SceneTurn through as many renames as it takes.

declare const SIM_TURN: unique symbol
declare const SCENE_TURN: unique symbol

/** A count of world turns — WorldMeta.simulationTurn and everything stamped from it. */
export type SimTurn = number & { readonly [SIM_TURN]: true }

/** A count of resolved player scenes — WorldMeta.currentTurnNumber. */
export type SceneTurn = number & { readonly [SCENE_TURN]: true }

/**
 * Assert that a raw number is a simulation turn.
 *
 * Every call is a claim about where the number came from, so keep them at
 * the boundary — reading WorldMeta.simulationTurn, reading a persisted turn
 * column, or a literal in a test — and let inference carry the brand from
 * there. A `simTurn()` in the middle of a call chain is how a crossing gets
 * laundered back in.
 */
export function simTurn(n: number): SimTurn {
  return n as SimTurn
}

/** Assert that a raw number is a scene counter. Same discipline as simTurn. */
export function sceneTurn(n: number): SceneTurn {
  return n as SceneTurn
}

/** The zero of the simulation clock — a campaign where nothing has ticked yet. */
export const SIM_TURN_ZERO: SimTurn = simTurn(0)

/**
 * Elapsed simulation turns between two points on the SAME clock.
 *
 * The signature is the whole point: `now - started` where the two came from
 * different clocks is exactly the `turns_elapsed: currentTurnNumber -
 * w.startedTurn` that told the AI GM about a war running for minus six
 * turns. Written as a function so the crossing is caught at the subtraction
 * rather than wherever the negative number eventually surfaces.
 */
export function turnsElapsed(now: SimTurn, since: SimTurn): number {
  return now - since
}
