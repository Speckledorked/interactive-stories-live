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

import { OracleTechnique } from './oracleTechnique'

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
 */
export function verifyOracleTechnique(
  technique: OracleTechnique,
  changedTestFiles: Record<string, string>
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

    case 'lint':
      // No custom ESLint rule exists in this repo yet (see the plan's
      // Phase 1d) — a checkKey should never be assigned this technique
      // until one does. Failing loudly here is the intended behavior, not
      // a bug: it means oracleTechnique.ts and this verifier have drifted
      // out of sync with what's actually enforceable.
      return { technique, satisfied: false, reason: 'no ESLint rule is wired up to verify this yet — this checkKey should not be assigned "lint" until one exists' }

    case 'suite-only':
      // The weakest oracle. Already covered by the workflow's general
      // `npx vitest run` step, and never auto-merge-eligible regardless —
      // nothing extra to check here.
      return { technique, satisfied: true, reason: 'suite-only requires no additional verification (and is never auto-merge-eligible)' }
  }
}
