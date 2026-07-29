// src/lib/game/integrity/verifyOracleTechnique.ts
// Phase 5 (plan section 5g/5h) — the mechanical check that stops an
// auto-fix PR from qualifying for auto-merge on the strength of the
// agent's OWN claim that it used the right oracle. "The AI doesn't get to
// grade its own homework" — a plain, honest content check on the actual
// changed test file(s), not a semantic understanding of them, but enough
// to catch the case that matters most: a fix whose only real evidence is
// "the suite stays green" dressed up as a stronger oracle.
//
// Deliberately shallow. This never tries to understand whether a property
// test is a GOOD property test — that's still a human's job on the
// resulting PR. It only answers "does this changed file even attempt the
// named technique," which is cheap, fast, and unambiguous.

import { OracleTechnique, LINT_GUARD_FILE_FOR } from './oracleTechnique'

export interface OracleTechniqueVerification {
  technique: OracleTechnique
  satisfied: boolean
  reason: string
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
  technique: OracleTechnique,
  changedTestFiles: Record<string, string>,
  knownGuardFiles: ReadonlySet<string> = new Set()
): OracleTechniqueVerification {
  const contents = Object.values(changedTestFiles)

  switch (technique) {
    case 'property':
      return contents.some((c) => PROPERTY_MARKER.test(c))
        ? { technique, satisfied: true, reason: 'a changed test file imports fast-check' }
        : { technique, satisfied: false, reason: 'no changed test file imports fast-check — a round-trip property was required' }

    case 'fault-injection':
      return contents.some((c) => FAULT_INJECTION_MARKER.test(c))
        ? { technique, satisfied: true, reason: 'a changed test file gates on RUN_DB_TESTS, the established real-DB fault-injection convention' }
        : { technique, satisfied: false, reason: 'no changed test file gates on RUN_DB_TESTS — a real-database fault-injection test was required' }

    case 'lint': {
      // This repo has no ESLint installed at all — its AST-based
      // structural guards are real, standing vitest tests using the
      // TypeScript compiler API instead (see entityResolutionConvention
      // .test.ts). Unlike property/fault-injection, this checkKey doesn't
      // need a NEW test generated per fix: the guard already exists and
      // is already re-run by the workflow's general `npx vitest run` step
      // — verification here only confirms the checkKey's claimed guard
      // genuinely exists on disk, not that a new one was written.
      const guardFile = LINT_GUARD_FILE_FOR[checkKey]
      if (!guardFile) {
        return {
          technique,
          satisfied: false,
          reason: `no AST-based structural guard is registered for "${checkKey}" in LINT_GUARD_FILE_FOR — assign "lint" only once one exists`,
        }
      }
      return knownGuardFiles.has(guardFile)
        ? { technique, satisfied: true, reason: `backed by the standing structural guard at ${guardFile}, already re-run by the full suite` }
        : { technique, satisfied: false, reason: `LINT_GUARD_FILE_FOR names ${guardFile} for "${checkKey}", but that file no longer exists — the registry has drifted stale` }
    }

    case 'suite-only':
      // The weakest oracle. Already covered by the workflow's general
      // `npx vitest run` step, and never auto-merge-eligible regardless —
      // nothing extra to check here.
      return { technique, satisfied: true, reason: 'suite-only requires no additional verification (and is never auto-merge-eligible)' }
  }
}
