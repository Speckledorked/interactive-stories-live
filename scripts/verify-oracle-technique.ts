// scripts/verify-oracle-technique.ts
// Phase 5 CI entrypoint — reads the actual changed test files off git and
// hands their content to verifyOracleTechnique.ts (the pure, unit-tested
// check). This is the step that stops an auto-fix PR from qualifying for
// auto-merge on the agent's own say-so: it never trusts a claim, only the
// diff that actually landed.
//
// Usage: npx tsx scripts/verify-oracle-technique.ts <check-key> <technique> <base-ref>

import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { verifyOracleTechnique } from '../src/lib/game/integrity/verifyOracleTechnique'
import { LINT_GUARD_FILE_FOR, type OracleTechnique } from '../src/lib/game/integrity/oracleTechnique'

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
  const [checkKey, technique, baseRef] = process.argv.slice(2)
  if (!checkKey || !technique || !baseRef) {
    console.error('Usage: verify-oracle-technique.ts <check-key> <technique> <base-ref>')
    process.exit(2)
  }

  const files = changedTestFiles(baseRef)
  const result = verifyOracleTechnique(checkKey, technique as OracleTechnique, files, existingGuardFiles())

  console.log(`checkKey: ${checkKey}`)
  console.log(`Oracle technique: ${result.technique}`)
  console.log(`Changed test file(s): ${Object.keys(files).join(', ') || '(none)'}`)
  console.log(`Satisfied: ${result.satisfied} — ${result.reason}`)

  process.exit(result.satisfied ? 0 : 1)
}

main()
