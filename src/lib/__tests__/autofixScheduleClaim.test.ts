// src/lib/__tests__/autofixScheduleClaim.test.ts
//
// Whether integrity-autofix.yml runs on a schedule is a fact about one
// `on:` block, and three places claimed to know it.
//
// #478: the workflow's own header said "ENABLED FOR AUTOPILOT (`schedule`
// below is live)" directly above an `on:` block containing nothing but
// `workflow_dispatch`, and the ARCHITECTURE.md Scorecard row said the same.
// #394 had taken the schedule back off and told neither of them. So the
// repository's own source of truth for system state described a daily
// unattended agent that had not run unattended in months — which is the
// optimistic direction, and the one that misdirects an audit.
//
// Prose cannot be diffed against reality, but this particular claim can:
// the `on:` block is machine-readable, and every sentence about it should
// agree with it. So rather than pin the current answer, this reads the
// workflow and holds the documentation to whatever it says.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const WORKFLOW = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'integrity-autofix.yml'), 'utf8')
const ARCHITECTURE = readFileSync(join(REPO_ROOT, 'docs', 'ARCHITECTURE.md'), 'utf8')

/**
 * The `on:` block only — not the header comment, which is the thing being
 * checked. Everything from `\non:` to the next top-level key.
 */
function triggerBlock(): string {
  const match = WORKFLOW.match(/\non:\n([\s\S]*?)\n[a-z]/)
  expect(match, 'expected an `on:` block in integrity-autofix.yml').toBeTruthy()
  return match![1]
}

/** A `schedule:` key that is actually active, rather than commented out. */
function scheduleIsLive(): boolean {
  return triggerBlock()
    .split('\n')
    .some((line) => /^\s+schedule:/.test(line) && !/^\s*#/.test(line))
}

describe('the autofix pipeline schedule', () => {
  it('has a readable trigger block', () => {
    expect(triggerBlock()).toContain('workflow_dispatch')
  })

  it('is declared the same way by the workflow header', () => {
    // A single machine-readable line rather than a prose match. The header
    // legitimately QUOTES its own old wrong claim while explaining it, so
    // grepping for the sentence cannot tell an assertion from a citation —
    // the first version of this test failed on exactly that.
    const header = WORKFLOW.slice(0, WORKFLOW.indexOf('\nname:'))
    const declared = header.match(/^# SCHEDULE: (manual|live)$/m)
    expect(declared, 'integrity-autofix.yml needs a `# SCHEDULE: manual|live` header line').toBeTruthy()
    expect(
      declared![1] === 'live',
      `Header declares SCHEDULE: ${declared![1]}, but the \`on:\` block ${scheduleIsLive() ? 'enables' : 'does not enable'} a schedule.`
    ).toBe(scheduleIsLive())
  })

  it('is described the same way by the Scorecard', () => {
    // The specific stale sentence #478 found, plus the shape it would take
    // if someone rewrote it. A doc that says the schedule is on while the
    // workflow is manual is the failure this exists to prevent.
    const claimsLive =
      /`schedule` (?:was|is) (?:nonetheless )?(?:now )?(?:turned on|enabled)(?![^.]*taken back off)/.test(ARCHITECTURE)
    expect(
      claimsLive,
      claimsLive
        ? 'docs/ARCHITECTURE.md says the schedule is on. integrity-autofix.yml is manual.'
        : 'docs/ARCHITECTURE.md no longer says the schedule is on, but it is.'
    ).toBe(scheduleIsLive())
  })
})
