// src/lib/game/integrity/runIntegrityPass.ts
// The orchestrator: load the snapshot once, run every registered check,
// apply what has a repair (respecting the blast-radius caps), and report
// what happened. This is the ONE place that decides "is this actually
// applied" — checks and repair functions stay pure and never touch the DB
// themselves (see types.ts's doc comments for why that split matters).

import type { Prisma, PrismaClient } from '@prisma/client'
import { WorldChange } from '../tick/types'
import { INTEGRITY_CHECKS, INTEGRITY_REPAIRS } from './checkRegistry'
import { loadIntegritySnapshot } from './snapshot'
import { applyRepairWrite } from './applyRepairWrite'
import { MAX_REPAIRS_PER_ENTITY, MAX_REPAIRS_PER_PASS } from './caps'
import { IntegrityReport, IntegritySnapshot, Violation, repairToWorldChange } from './types'

type Db = Prisma.TransactionClient | PrismaClient

export interface IntegrityPassResult {
  changes: WorldChange[]
  report: IntegrityReport
}

/**
 * Run every registered check against a campaign and apply what can be
 * auto-repaired, up to the blast-radius caps. `dryRun` mirrors the rest of
 * the tick's preview mode (TickContext.dryRun): every check still runs and
 * every repair is still decided and reported, only the actual write is
 * skipped — so the admin tick preview shows pending repairs with no
 * separate code path.
 */
export async function runIntegrityPass(
  db: Db,
  campaignId: string,
  turnNumber: number,
  options: { dryRun?: boolean } = {}
): Promise<IntegrityPassResult> {
  const dryRun = options.dryRun ?? false
  const snapshot = await loadIntegritySnapshot(db, campaignId, turnNumber)

  const { violations, perCheckMs } = runChecks(snapshot)
  const { changes, unrepaired, repairsApplied } = await applyRepairs(db, snapshot, violations, dryRun)

  const report: IntegrityReport = {
    campaignId,
    turnNumber,
    timestamp: new Date().toISOString(),
    violationsFound: violations.length,
    repairsApplied,
    unrepaired,
    perCheckMs,
  }

  return { changes, report }
}

function runChecks(snapshot: IntegritySnapshot): { violations: Violation[]; perCheckMs: Record<string, number> } {
  const violations: Violation[] = []
  const perCheckMs: Record<string, number> = {}
  for (const check of INTEGRITY_CHECKS) {
    const start = Date.now()
    violations.push(...check.run(snapshot))
    perCheckMs[check.key] = Date.now() - start
  }
  return { violations, perCheckMs }
}

async function applyRepairs(
  db: Db,
  snapshot: IntegritySnapshot,
  violations: Violation[],
  dryRun: boolean
): Promise<{ changes: WorldChange[]; unrepaired: Violation[]; repairsApplied: number }> {
  const changes: WorldChange[] = []
  const unrepaired: Violation[] = []
  const repairCountByEntity = new Map<string, number>()
  let repairsApplied = 0

  for (const violation of violations) {
    const repairFn = INTEGRITY_REPAIRS[violation.checkKey]
    if (!repairFn) {
      // No entry means detect-only by design (duplicate names, a clock tied
      // to a collapsed faction) — reported the same as a repair fn
      // declining, never silently dropped.
      unrepaired.push(violation)
      continue
    }

    if (repairsApplied >= MAX_REPAIRS_PER_PASS) {
      unrepaired.push(violation)
      continue
    }
    const entityKey = `${violation.entityType}:${violation.entityId}`
    const entityRepairCount = repairCountByEntity.get(entityKey) ?? 0
    if (entityRepairCount >= MAX_REPAIRS_PER_ENTITY) {
      unrepaired.push(violation)
      continue
    }

    const repair = repairFn(violation, snapshot)
    if (!repair) {
      unrepaired.push(violation)
      continue
    }

    if (!dryRun) {
      await applyRepairWrite(db, repair.write)
    }
    changes.push(repairToWorldChange(repair, snapshot.campaignId))
    repairsApplied++
    repairCountByEntity.set(entityKey, entityRepairCount + 1)
  }

  return { changes, unrepaired, repairsApplied }
}
