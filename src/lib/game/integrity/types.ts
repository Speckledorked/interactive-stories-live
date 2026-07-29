// src/lib/game/integrity/types.ts
// World Sim — Integrity Engine core types.
//
// Structural tier only (Phase 1): "does every reference in this campaign's
// data point at something real". Checks are pure functions over a snapshot
// already loaded from the DB — the same split as every decideX function in
// tick/ (decideClockAdvancement, decideFactionGoalReassessment,
// decideTerritoryClaim): a check never touches Prisma, so it's testable with
// a literal object and has no timing/ordering surprises.
//
// This mirrors tick/leadershipTick.ts's framing on purpose — "ensures an
// invariant holds" rather than "something just happened" — generalized from
// one hand-written invariant into a registry of them.

import { TickEntityType, WorldChange } from '../tick/types'

/** One fact the engine asserts must hold for every campaign, regardless of
 * setting or fiction (see integrity/checks/ for the structural-tier list;
 * Phase 4 adds a universe-scoped semantic tier on top of this same shape). */
export interface IntegrityCheck {
  /** Stable id — never renamed once shipped, since Violation.checkKey is
   * what oscillation-detection (Phase 1d) correlates across turns. */
  key: string
  description: string
  /** Pure: reads the snapshot, returns nothing else. No DB access, no Date.now(). */
  run: (snapshot: IntegritySnapshot) => Violation[]
}

export interface Violation {
  checkKey: string
  entityType: TickEntityType
  entityId: string
  entityName: string
  /** Human-readable description of what's wrong, for the diagnostics panel. */
  description: string
}

/** A repair is a pure, already-decided write — runIntegrityPass applies it,
 * never a check or the repair function itself. previousValue/newValue mirror
 * WorldChange's shape so every repair is a WorldChange (invertible, logged to
 * WorldEvent) with zero translation step. */
export interface Repair {
  violation: Violation
  /**
   * What the resulting WorldChange should describe — usually the same
   * entity the violation was found on, but not always: a faction missing a
   * leader is a violation ON the faction, but the repair promotes an NPC,
   * and the change should read the way tick/leadershipTick.ts's own
   * "NPC's role changed" event already does, not "the faction changed".
   * Defaults to the violation's own entity when a repair fn doesn't need to
   * differ (see applyRepair in runIntegrityPass.ts).
   */
  entityType?: TickEntityType
  entityId?: string
  entityName?: string
  field: string
  previousValue: string | number
  newValue: string | number
  description: string
  /** The Prisma write this repair requires, applied by runIntegrityPass —
   * kept declarative (not a closure) so a repair is inspectable/loggable
   * before it's ever applied, and so dryRun can report it without touching
   * the DB in any way, not even by constructing a client-bound closure. */
  write: RepairWrite
}

export type RepairWrite =
  | { model: 'clock'; id: string; data: Record<string, unknown> }
  | { model: 'character'; id: string; data: Record<string, unknown> }
  | { model: 'nPC'; id: string; data: Record<string, unknown> }
  | { model: 'faction'; id: string; data: Record<string, unknown> }
  | { model: 'debt'; id: string; data: Record<string, unknown> }
  | { model: 'war'; id: string; data: Record<string, unknown> }

/** A repair function is pure too: given a violation and the same snapshot
 * the check ran against, decide the fix (or decline — `null` means "flagged
 * but not auto-repairable", which the pass reports rather than silently
 * dropping). */
export type RepairFn = (violation: Violation, snapshot: IntegritySnapshot) => Repair | null

/** Minimal shape of every entity kind a check might reference. Loaded once
 * per pass by integrity/snapshot.ts — checks never query the DB themselves,
 * so every check runs against the exact same consistent read. */
export interface IntegritySnapshot {
  campaignId: string
  turnNumber: number
  locationIds: Set<string>
  npcs: SnapshotNpc[]
  factions: SnapshotFaction[]
  characters: SnapshotCharacter[]
  clocks: SnapshotClock[]
  debts: SnapshotDebt[]
  wars: SnapshotWar[]
  quests: SnapshotQuest[]
}

export interface SnapshotNpc {
  id: string
  name: string
  isAlive: boolean
  factionId: string | null
  factionRole: 'LEADER' | 'MEMBER' | null
  importance: number
  socialTies: unknown
}

export interface SnapshotFaction {
  id: string
  name: string
  isActive: boolean
  leaderCharacterId: string | null
  relationships: unknown
}

export interface SnapshotCharacter {
  id: string
  name: string
  relationships: unknown
  resources: unknown
}

export interface SnapshotClock {
  id: string
  name: string
  resolvedAt: Date | null
  sourceFactionId: string | null
  participantNpcIds: string[]
}

export interface SnapshotDebt {
  id: string
  counterpartyId: string | null
  counterpartyName: string
  counterpartyType: string
}

export interface SnapshotWar {
  id: string
  name: string
  status: string
  contestedLocationId: string | null
}

export interface SnapshotQuest {
  id: string
  name: string
}

/**
 * A recurrence pattern across turns that looks like a code bug, not routine
 * drift — see integrity/escalation.ts. The engine surfaces this as
 * evidence; it never attempts a fix. `sample` is deliberately full enough
 * (entity, description, previous/new values) to seed a regression test by
 * hand without going back to the DB.
 */
export interface Escalation {
  checkKey: string
  kind: 'recurring-entity' | 'systemic'
  /** Distinct entities this checkKey has fired on. */
  entityIds: string[]
  /** Every turn this checkKey has fired on, across all entities, sorted ascending. */
  turnNumbers: number[]
  occurrences: number
  sample: Violation
}

export interface IntegrityReport {
  campaignId: string
  turnNumber: number
  timestamp: string
  violationsFound: number
  repairsApplied: number
  /** Violations flagged with no repair function, or that hit the
   * blast-radius cap before being applied — never silently dropped. */
  unrepaired: Violation[]
  /** Recurrence patterns across turns that look like a code bug — see
   * integrity/escalation.ts. Empty on nearly every pass. */
  escalations: Escalation[]
  perCheckMs: Record<string, number>
}

/** Converts an applied repair into the same WorldChange shape every other
 * tick handler emits, so it flows through the existing persistWorldEvents /
 * logSignificantChanges / syncWikiEntriesForChanges fan-out unchanged. */
export function repairToWorldChange(repair: Repair, campaignId: string): WorldChange {
  return {
    entityType: repair.entityType ?? repair.violation.entityType,
    entityId: repair.entityId ?? repair.violation.entityId,
    entityName: repair.entityName ?? repair.violation.entityName,
    campaignId,
    field: repair.field,
    previousValue: repair.previousValue,
    newValue: repair.newValue,
    reason: repair.description,
    // Integrity repairs are always worth a history entry — by definition
    // they're the world engine correcting something that was wrong, which
    // is a more notable event than routine tick drift.
    significant: true,
    importance: 'NORMAL',
    // Distinct from the default 'tick' origin, and carrying checkKey, so
    // escalation (integrity/escalation.ts) can tell an integrity repair
    // apart from an ordinary write to the same field — Character.relationships
    // changes constantly from normal scene play, and conflating the two
    // would make every campaign look like a recurring bug.
    origin: 'integrity',
    checkKey: repair.violation.checkKey,
  }
}
