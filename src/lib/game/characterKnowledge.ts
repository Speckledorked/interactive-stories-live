// src/lib/game/characterKnowledge.ts
//
// What one character knows, as the player can read it (#520).
//
// tick/informationTick.ts already answers "who knows about this event" —
// by witnessing it, by physical distance from where it happened, or by
// social distance through people they know, whichever is faster — and
// writes the answer to EventWitness. Until this module the answer went
// one place only: a block of the narration prompt. The game modelled the
// player's own knowledge and then declined to tell them any of it.
//
// This is the read side, and it is deliberately NOT eventWitness.ts.
// That module assembles the same rows for the prompt and does it by
// concatenating WorldEvent.reason, which is the simulation's private
// account of why it made a call — the exact field
// api/campaigns/[id]/world-events is admin-gated to protect. A player
// surface cannot reuse any of it, so this builds sentences from the
// structured columns through worldEventPhrasing.ts instead.
//
// Pure, and dependency-free apart from the phrasing vocabulary, so the
// route hands it rows and a 'use client' component can share its types.

import {
  phraseWorldEvent,
  type WorldEventKind,
  type PhraseableEvent,
} from './worldEventPhrasing'

/**
 * How many entries of each kind reach the player.
 *
 * Far higher than eventWitness.ts's MAX_WITNESSED_EVENTS_IN_PROMPT (6) /
 * MAX_TOLD_EVENTS_IN_PROMPT (4), and for a different reason: those caps
 * exist to protect a token budget. A screen has no token budget, it has a
 * scroll bar, and a character who has been playing for months should be
 * able to look back over what they have learned. Capped at all only so an
 * old campaign cannot ship an unbounded payload.
 */
export const MAX_KNOWN_EVENTS_PER_SOURCE = 30

/** The EventWitness + WorldEvent join this module reads. */
export interface KnowledgeRow {
  grade: 'WITNESSED' | 'TOLD'
  /** When this character LEARNED it — already denormalized onto the row,
   *  so a TOLD entry sorts by when word arrived, not when it happened. */
  turnNumber: number
  distorted: boolean
  event: PhraseableEvent
}

export interface KnownEvent {
  /** The player-facing sentence. Never the simulation's reasoning. */
  text: string
  kind: WorldEventKind
  /** The turn this character learned it. */
  turnNumber: number
  /**
   * Whether something about the account does not sit right.
   *
   * Only ever true on a secondhand entry: WITNESSED rows are ground truth
   * by construction and informationTick never distorts them.
   *
   * Deliberately a BOOLEAN, where the prompt path (eventWitness.ts's
   * DISTORTION_SUFFIXES) gets the specific EventWitnessDistortion flavor.
   * The narrator needs the flavor to narrate the rumor consistently; the
   * player must not have it, because "this account sounds exaggerated"
   * tells them the truth is smaller — which is a piece of the answer key.
   * What the character can honestly sense is that the story smells off,
   * not which way it has been bent.
   */
  doubtful: boolean
}

export interface CharacterKnowledge {
  /** Events this character was present for. Most recent first. */
  firsthand: KnownEvent[]
  /** Events word of which reached them later. Most recent first. */
  secondhand: KnownEvent[]
}

/**
 * Project witness rows into the two lists a player reads.
 *
 * Rows with no player-facing phrasing are dropped rather than rendered
 * generically — see worldEventPhrasing.ts on why absent means silent. A
 * character can therefore know fewer things on screen than in the
 * prompt, which is the correct direction for the error to run.
 *
 * The two sources are capped independently so a character who has
 * witnessed a great deal does not crowd out everything they were told,
 * the same reasoning eventWitness.ts applies to its own two caps.
 */
export function buildCharacterKnowledge(rows: KnowledgeRow[]): CharacterKnowledge {
  const firsthand: KnownEvent[] = []
  const secondhand: KnownEvent[] = []

  for (const row of rows) {
    const phrased = phraseWorldEvent(row.event)
    if (!phrased) continue

    const witnessed = row.grade === 'WITNESSED'
    const entry: KnownEvent = {
      text: phrased.text,
      kind: phrased.kind,
      turnNumber: row.turnNumber,
      // Belt and braces: the schema's own comment says distortion is only
      // ever set on TOLD rows, enforced by the caller rather than the
      // database. Re-asserting it here means a future writer that breaks
      // that invariant cannot make a firsthand account look doubtful.
      doubtful: !witnessed && row.distorted,
    }
    ;(witnessed ? firsthand : secondhand).push(entry)
  }

  const byRecency = (a: KnownEvent, b: KnownEvent) => b.turnNumber - a.turnNumber
  return {
    firsthand: firsthand.sort(byRecency).slice(0, MAX_KNOWN_EVENTS_PER_SOURCE),
    secondhand: secondhand.sort(byRecency).slice(0, MAX_KNOWN_EVENTS_PER_SOURCE),
  }
}
