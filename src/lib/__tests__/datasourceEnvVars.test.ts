// src/lib/__tests__/datasourceEnvVars.test.ts
//
// #500: schema.prisma declares a `directUrl`, and Prisma resolves EVERY
// datasource variable before it will run a migration — so an unset one
// fails at CONFIG time, not connection time. That distinction is the whole
// hazard: `prisma generate` succeeds without it, `tsc` succeeds without it,
// the test suite succeeds without it, and then `prisma migrate deploy`
// refuses in the one place where failing is most expensive.
//
// It is also easy to get wrong in exactly one direction. Adding a directUrl
// is a one-line schema edit; remembering that two CI jobs and a build
// command now need a new environment variable is not part of that line.
//
// So this checks the pairing rather than any particular value: if the
// datasource names an env var, every workflow job that runs a migration
// must set it.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const SCHEMA = readFileSync(join(REPO_ROOT, 'prisma', 'schema.prisma'), 'utf8')
const WORKFLOWS = join(REPO_ROOT, '.github', 'workflows')

/** Every env var the datasource block reads, e.g. DATABASE_URL. */
function datasourceEnvVars(): string[] {
  const block = SCHEMA.match(/datasource db \{([\s\S]*?)\n\}/)
  expect(block, 'datasource block not found — this guard needs updating').toBeTruthy()
  const body = block![1]
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  return [...body.matchAll(/env\("([^"]+)"\)/g)].map((m) => m[1])
}

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
}

describe('datasource environment variables', () => {
  it('reads both a pooled and a direct URL', () => {
    const vars = datasourceEnvVars()
    expect(vars).toContain('DATABASE_URL')
    // The direct route exists because migrations use session-level features
    // a transaction pooler does not preserve.
    expect(vars.length).toBeGreaterThan(1)
  })

  it('documents every one of them in .env.example', () => {
    const example = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8')
    const undocumented = datasourceEnvVars().filter((v) => !example.includes(v))
    expect(
      undocumented,
      `The datasource reads these, and nothing tells a new deploy they exist: ${undocumented.join(', ')}`
    ).toEqual([])
  })

  it('sets every one of them in each workflow job that runs a migration', () => {
    const missing: string[] = []
    const vars = datasourceEnvVars()

    for (const file of workflowFiles()) {
      const source = readFileSync(join(WORKFLOWS, file), 'utf8')
      if (!source.includes('prisma migrate deploy')) continue
      for (const v of vars) {
        // Present as a key somewhere in the file's env blocks. Coarse on
        // purpose: a finer check would need a YAML parser and the failure
        // it guards against is an omission, not a subtle mis-scoping.
        if (!new RegExp(`^\\s*${v}:`, 'm').test(source)) {
          missing.push(`${file} needs ${v}`)
        }
      }
    }

    expect(
      missing,
      `prisma migrate deploy resolves every datasource variable before it runs, so an ` +
        `unset one fails at config time:\n  ${missing.join('\n  ')}`
    ).toEqual([])
  })
})
