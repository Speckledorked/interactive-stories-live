// scripts/verify-oracle-technique.ts
// Phase 5 CI entrypoint — reads the actual changed test files off git and
// hands their content to verifyOracleTechnique.ts (the pure, unit-tested
// check). This is the step that stops an auto-fix from merging on the
// agent's own say-so: it never trusts a claim, only the diff that
// actually landed.
//
// `priorTechnique` is passed in (computed by check-escalations.ts BEFORE
// the agent ran); the CURRENT technique is imported live from
// oracleTechnique.ts, which reflects whatever the agent's commits actually
// left in that file — including a legitimate upgrade to a stronger
// technique, or (checked and rejected) an illegitimate downgrade.
//
// Usage: npx tsx scripts/verify-oracle-technique.ts <check-key> <prior-technique> <base-ref>

import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { verifyOracleTechnique } from '../src/lib/game/integrity/verifyOracleTechnique'
import { LINT_GUARD_FILE_FOR, oracleTechniqueFor, type OracleTechnique } from '../src/lib/game/integrity/oracleTechnique'

const REPO_ROOT = join(__dirname, '..')

function changedTestFiles(baseRef: string): Record<string, string> {
  const diffOutput = execSync(`git diff --name-only --diff-filter=ACM ${baseRef}...HEAD`, { encoding: 'utf-8' })
  const files = diffOutput
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.endsWith('.test.ts') || f.endsWith('.test.tsx'))

  const contents: Record<string, string> = {}
  for (const file of files) {
    try {
      contents[file] = readFileSync(file, 'utf-8')
    } catch {
      // Deleted in this diff (deleted files fail --diff-filter=ACM but a
      // rename can still surface an old path in some git versions) —
      // nothing to read, nothing to verify against.
    }
  }
  return contents
}

function existingGuardFiles(): Set<string> {
  return new Set(Object.values(LINT_GUARD_FILE_FOR).filter((path) => existsSync(join(REPO_ROOT, path))))
}

function main() {
  const [checkKey, priorTechnique, baseRef] = process.argv.slice(2)
  if (!checkKey || !priorTechnique || !baseRef) {
    console.error('Usage: verify-oracle-technique.ts <check-key> <prior-technique> <base-ref>')
    process.exit(2)
  }

  // Live lookup — reflects the agent's actual commits, not the value from
  // before it ran, so a real upgrade (or an attempted downgrade) is seen.
  const currentTechnique = oracleTechniqueFor(checkKey)

  const files = changedTestFiles(baseRef)
  const result = verifyOracleTechnique(
    checkKey,
    priorTechnique as OracleTechnique,
    currentTechnique,
    files,
    existingGuardFiles()
  )

  console.log(`checkKey: ${checkKey}`)
  console.log(`Oracle technique: ${priorTechnique} -> ${result.technique}`)
  console.log(`Changed test file(s): ${Object.keys(files).join(', ') || '(none)'}`)
  console.log(`Satisfied: ${result.satisfied} — ${result.reason}`)

  process.exit(result.satisfied ? 0 : 1)
}

main()
