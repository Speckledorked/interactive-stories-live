// scripts/__tests__/prClosingKeywordsWorkflow.test.ts
//
// #453: the closing-keyword gate reads the PULL REQUEST BODY, so it has to
// re-run when the body changes.
//
// It first shipped as a job in ci.yml, whose `pull_request:` trigger has no
// `types:` — which means [opened, synchronize, reopened]. A body edit produced
// no run at all. The defect therefore walked straight through the check
// written to catch it: open with `Closes #453.`, edit to `Closes #453, #451`
// an hour later, merge, and #451 is silently dropped having never been
// examined. The gate stays green on a version of the body that no longer
// exists — #443's shape, a gate reporting success without looking at the thing
// it gates.
//
// Found by forcing the gate to fail in CI rather than only watching it pass.
//
// This guard exists because the fix is a WORKFLOW TRIGGER, which is invisible
// at the point of use: nothing about the script says "my host workflow needs
// `edited`", and consolidating the job back into ci.yml to tidy up would look
// like a pure refactor while re-blinding the gate. The trigger is the
// correctness property, so it gets asserted like one.
//
// Deliberately DISCOVERY-BASED rather than path-hardcoded: it finds whichever
// workflow invokes the script and checks that one. Moving the gate to a
// differently-named file keeps this passing; moving it somewhere without
// `edited` fails it. A guard that hardcodes the filename would pass forever
// after someone moved the job, which is the failure it is meant to prevent.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const WORKFLOW_DIR = join(process.cwd(), '.github', 'workflows')
const GATE_SCRIPT = 'scripts/check-pr-closing-keywords.ts'

/** Workflow files that actually run the gate. */
function hostWorkflows(): { file: string; content: string }[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((file) => ({ file, content: readFileSync(join(WORKFLOW_DIR, file), 'utf-8') }))
    .filter(({ content }) => content.includes(GATE_SCRIPT))
}

/**
 * The `on:` block, comments stripped.
 *
 * Top-level YAML keys start at column 0, so the block runs from the `on:` line
 * to the next unindented line. Comments are dropped so a mention of `edited`
 * in prose cannot satisfy the assertion below — the whole point is the real
 * trigger, not a claim about it.
 */
function triggerBlock(content: string): string {
  const lines = content.split('\n')
  const start = lines.findIndex((l) => /^on:/.test(l))
  if (start === -1) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) { end = i; break }
  }
  return lines
    .slice(start, end)
    .map((l) => l.replace(/#.*$/, ''))
    .join('\n')
}

describe('the closing-keyword gate reruns on body edits (#453)', () => {
  const hosts = hostWorkflows()

  it('is wired into a workflow at all', () => {
    // If this ever finds nothing, the gate is not running anywhere and every
    // other assertion here would vacuously pass.
    expect(hosts.map((h) => h.file)).not.toEqual([])
  })

  it('runs on `edited`, not just opened/synchronize/reopened', () => {
    for (const { file, content } of hosts) {
      const on = triggerBlock(content)

      expect(on, `${file}: no top-level \`on:\` block found`).not.toBe('')
      expect(on, `${file}: the gate must run on pull_request`).toContain('pull_request')
      expect(
        on,
        `${file} runs ${GATE_SCRIPT} but its \`on:\` block does not list \`edited\`.\n` +
          'A PR body stays editable until the merge, so a gate that reads the body\n' +
          'and does not re-run on `edited` can be green on text that no longer exists.\n' +
          'Add `types: [opened, edited, synchronize, reopened]` under `pull_request:`.'
      ).toContain('edited')
    }
  })

  it('declares types explicitly rather than relying on the default', () => {
    // `pull_request:` with no `types:` is the exact bug: the default set omits
    // `edited`. Requiring the key to be present keeps that implicit default
    // from creeping back in.
    for (const { file, content } of hosts) {
      expect(triggerBlock(content), `${file}: \`pull_request:\` needs an explicit \`types:\``)
        .toMatch(/types:/)
    }
  })

  it('passes the body through env, never interpolated into a run script', () => {
    // A PR body is attacker-controlled text, and `${{ }}` inside a shell
    // command is a script-injection surface. Checked here because it is the
    // same one-line-of-YAML class of mistake as the trigger.
    for (const { file, content } of hosts) {
      const runLines = content
        .split('\n')
        .filter((l) => l.includes('run:') || l.trimStart().startsWith('npx tsx'))
      for (const line of runLines) {
        expect(line, `${file}: PR body interpolated into a run script`).not.toMatch(
          /\$\{\{\s*github\.event\.pull_request\.body/
        )
      }
      expect(content, `${file}: the body should reach the script via env:`).toMatch(
        /PR_BODY:\s*\$\{\{\s*github\.event\.pull_request\.body\s*\}\}/
      )
    }
  })
})
