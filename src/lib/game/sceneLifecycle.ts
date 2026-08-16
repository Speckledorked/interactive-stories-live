// src/lib/game/sceneLifecycle.ts
// #406: one answer to "what state is this scene in?"
//
// Three orthogonal signals were being combined ad hoc by every caller:
//
//   - Scene.status     — AWAITING_ACTIONS | RESOLVING | RESOLVED
//   - Scene.isPaused   — a boolean whose own schema comment states it is
//                        NOT a status
//   - progressState    — beat tracking
//
// Each was added for a different concern and none was made subordinate to
// a lifecycle, so "is this scene over / active / resumable" had as many
// answers as there were call sites composing them. The schema comment on
// isPaused is a warning about the ambiguity rather than a resolution of it.
//
// This is the resolution: status is authoritative for WHERE the scene is,
// isPaused is a MODIFIER on an active scene (a GM holding play, not a
// state of its own), and beats are progress within an active scene and
// never a lifecycle signal. Callers ask this module rather than each
// re-deriving the combination.

import type { SceneStatus } from '@prisma/client'

/**
 * The one vocabulary.
 *
 * - `active`    — accepting actions right now.
 * - `paused`    — active, but a GM is holding play. Resumable; NOT over.
 * - `resolving` — the AI is mid-resolution. Transient, and not a state a
 *                 player action may be submitted into.
 * - `over`      — resolved. Terminal.
 */
export type SceneLifecycle = 'active' | 'paused' | 'resolving' | 'over'

export interface SceneLifecycleInput {
  status: SceneStatus
  isPaused?: boolean | null
}

/**
 * Derive the single lifecycle state.
 *
 * Order matters and encodes the subordination: a RESOLVED scene is over
 * whether or not somebody left it paused (pausing a finished scene means
 * nothing), and RESOLVING outranks paused because the resolution is
 * already in flight.
 */
export function sceneLifecycle(scene: SceneLifecycleInput): SceneLifecycle {
  if (scene.status === 'RESOLVED') return 'over'
  if (scene.status === 'RESOLVING') return 'resolving'
  return scene.isPaused ? 'paused' : 'active'
}

/** Is this scene finished? The question most call sites are actually asking. */
export function isSceneOver(scene: SceneLifecycleInput): boolean {
  return sceneLifecycle(scene) === 'over'
}

/**
 * May a player submit an action into this scene right now?
 *
 * Not the same as "is it over": a paused scene is not over, and a
 * resolving one is not over either, but neither accepts input.
 */
export function acceptsPlayerActions(scene: SceneLifecycleInput): boolean {
  return sceneLifecycle(scene) === 'active'
}

/** Can play be picked back up here? */
export function isSceneResumable(scene: SceneLifecycleInput): boolean {
  return sceneLifecycle(scene) === 'paused'
}
