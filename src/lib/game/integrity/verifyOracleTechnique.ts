// src/lib/game/integrity/verifyOracleTechnique.ts
// Phase 5 — the mechanical check that stops an auto-fix from merging on
// the strength of the agent's OWN claim that it used the right oracle.
// "The AI doesn't get to grade its own homework" — a plain, honest content
// check on the actual changed test file(s), not a semantic understanding
// of them, but enough to catch the case that matters most: a fix whose
// only real evidence is "the suite stays green" dressed up as a stronger
// oracle.
//
// There is no human review step in this pipeline — every technique tier
// auto-merges once this check (and the full suite) passes. That's exactly
// why the FIRST thing this checks isn't "does the new test look right,"
// it's "did this diff quietly lower the bar for itself": `priorTechnique`
// is what oracleTechnique.ts declared for this checkKey BEFORE the agent
// ran, `currentTechnique` is what it declares AFTER (the agent is allowed
// to raise its own bar — write a stronger test, register a stronger
// technique — but never lower it). See regressionDetection.ts for the
// other half of the safety story: if this check is ever wrong anyway, the
// system notices the checkKey escalating again and reverts itself.
//
// Deliberately shallow otherwise. This never tries to understand whether a
// property test is a GOOD property test — it only answers "does this
// changed file even attempt the named technique," which is cheap, fast,
// and unambiguous.

import { OracleTechnique, LINT_GUARD_FILE_FOR, isWeakerTechnique } from './oracleTechnique'
import { CheckKey } from './checkKeys'

export interface OracleTechniqueVerification {
  technique: OracleTechnique
  satisfied: boolean
  reason: string
  weakened: boolean
}

const PROPERTY_MARKER = /from ['"]fast-check['"]/
const FAULT_INJECTION_MARKER = /RUN_DB_TESTS/

/**
 * `changedTestFiles` should be the content of every test file the PR
 * added or modified (not source files) — the caller (verify-oracle-
 * technique.ts) reads those off `git diff` and passes contents in, so
 * this stays a pure function with no filesystem/git access of its own.
 *
 * `knownGuardFiles` is only consulted for the 'lint' technique — the set
 * of standing AST-guard file paths that actually exist on disk right now
 * (the caller resolves this via LINT_GUARD_FILE_FOR + a real fs check;
 * kept as a plain set here so this function stays pure and easy to test
 * with a literal fixture instead of mocking the filesystem).
 */
export function verifyOracleTechnique(
  checkKey: string,
  priorTechnique: OracleTechnique,
  currentTechnique: OracleTechnique,
  changedTestFiles: Record<string, string>,
  knownGuardFiles: ReadonlySet<string> = new Set()
): OracleTechniqueVerification {
  if (isWeakerTechnique(priorTechnique, currentTechnique)) {
    return {
      technique: currentTechnique,
      satisfied: false,
      weakened: true,
      reason: `oracleTechnique.ts now declares "${checkKey}" as "${currentTechnique}", weaker than its prior "${priorTechnique}" — a single diff can never lower its own bar`,
    }
  }

  const contents = Object.values(changedTestFiles)

  switch (currentTechnique) {
    case 'property':
      return contents.some((c) => PROPERTY_MARKER.test(c))
        ? { technique: currentTechnique, satisfied: true, weakened: false, reason: 'a changed test file imports fast-check' }
        : { technique: currentTechnique, satisfied: false, weakened: false, reason: 'no changed test file imports fast-check — a round-trip property was required' }

    case 'fault-injection':
      return contents.some((c) => FAULT_INJECTION_MARKER.test(c))
        ? { technique: currentTechnique, satisfied: true, weakened: false, reason: 'a changed test file gates on RUN_DB_TESTS, the established real-DB fault-injection convention' }
        : { technique: currentTechnique, satisfied: false, weakened: false, reason: 'no changed test file gates on RUN_DB_TESTS — a real-database fault-injection test was required' }

    case 'lint': {
      // This repo has no ESLint installed at all — its AST-based
      // structural guards are real, standing vitest tests using the
      // TypeScript compiler API instead (see entityResolutionConvention
      // .test.ts). Unlike property/fault-injection, this checkKey doesn't
      // need a NEW test generated per fix: the guard already exists and
      // is already re-run by the workflow's general `npx vitest run` step
      // — verification here only confirms the checkKey's claimed guard
      // genuinely exists on disk, not that a new one was written.
      const guardFile = LINT_GUARD_FILE_FOR[checkKey as CheckKey]
      if (!guardFile) {
        return {
          technique: currentTechnique,
          satisfied: false,
          weakened: false,
          reason: `no AST-based structural guard is registered for "${checkKey}" in LINT_GUARD_FILE_FOR — assign "lint" only once one exists`,
        }
      }
      return knownGuardFiles.has(guardFile)
        ? { technique: currentTechnique, satisfied: true, weakened: false, reason: `backed by the standing structural guard at ${guardFile}, already re-run by the full suite` }
        : { technique: currentTechnique, satisfied: false, weakened: false, reason: `LINT_GUARD_FILE_FOR names ${guardFile} for "${checkKey}", but that file no longer exists — the registry has drifted stale` }
    }

    case 'suite-only':
      // The weakest oracle, but it still merges — the full suite passing
      // (checked separately, unconditionally) is the whole proof here.
      return { technique: currentTechnique, satisfied: true, weakened: false, reason: 'suite-only requires no additional verification beyond the full suite passing' }
  }
}
