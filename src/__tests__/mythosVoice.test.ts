// src/__tests__/mythosVoice.test.ts
//
// The product never calls itself AI. It is MythOS — the game master of the
// world, in the same voice the fiction is written in.
//
// This is a product rule, not a style preference, and it decays the way every
// uncheckable rule decays: one feature at a time, each adding "AI cost" or
// "AI settings" to a label because the surrounding code is full of AI_*
// identifiers and the word feels native. So it is a test, like every other
// invariant in this repo.
//
// What it checks: user-visible COPY. Internal identifiers are untouched and
// deliberately so — src/lib/ai/**, AI_MODELS, recordAICost, AIGMRequest and
// the rest are names for the machinery, and renaming them would be churn with
// no reader. The matcher below only fires on a standalone word, so it cannot
// see AI_MODELS or AITransparencyPanel; it sees "AI cost", "AI GM", "an AI".
//
// Comments are stripped before matching, so explaining the machinery in a
// comment is always allowed — this very file does it.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { globSync } from 'glob'

const ROOT = join(__dirname, '..', '..')

/**
 * Surfaces a player (or a campaign host, who is a player) can read.
 *
 * src/app/admin/** is excluded: that is the platform operator console, gated
 * on PLATFORM_ADMIN_EMAILS, and its audience is whoever runs the service —
 * "AI cost by campaign" is the honest label for an operator cost report.
 * Campaign-level /campaigns/[id]/admin is NOT excluded: its audience is the
 * player hosting the table.
 */
const COPY_GLOBS = [
  'src/app/**/*.tsx',
  'src/components/**/*.tsx',
  'src/lib/tutorial/content/**/*.ts',
  'src/lib/notifications/email-service.ts',
  'src/lib/ai/validation.ts',
  'src/lib/game/campaign-health.ts',
]

const EXCLUDED = ['src/app/admin/']

/** Words that break the conceit wherever a user can read them. */
const FORBIDDEN: Array<[string, RegExp]> = [
  ['AI', /\bAI\b/],
  ['A.I.', /\bA\.I\./],
  ['artificial intelligence', /artificial intelligence/i],
  ['LLM', /\bLLMs?\b/],
  ['language model', /language model/i],
  ['chatbot', /\bchat ?bots?\b/i],
  ['OpenAI', /\bOpenAI\b/],
  ['Anthropic', /\bAnthropic\b/],
  ['GPT', /\bGPT\b/],
]

/**
 * Strip comments so that explaining the machinery never trips the check.
 * Deliberately crude: it also blanks anything that merely LOOKS like a
 * comment inside a string. That direction of error is safe — it can only
 * hide a violation from a line that also contains "//", which no copy string
 * in this codebase does — and the alternative is parsing TSX properly for a
 * check whose whole value is that it stays simple enough to trust.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s\/\/.*$/gm, ' ')
}

/**
 * Log lines are machinery, not copy. "Calling AI GM..." in a console line is
 * an accurate thing to tell a developer reading a server log, and renaming it
 * would make debugging less clear, not more in-voice.
 *
 * The exclusion is deliberately narrow — the line must itself be the log call.
 * `const msg = 'AI GM'` followed by `console.log(msg)` is still a violation on
 * the assignment line, which is the line that could also reach a user.
 */
function isLogLine(line: string): boolean {
  return /\b(?:console\.(?:log|warn|error|info|debug)|devLog|reportError)\s*\(/.test(line)
}

function copyFiles(): string[] {
  return COPY_GLOBS.flatMap((g) => globSync(g, { cwd: ROOT }))
    .filter((f) => !EXCLUDED.some((e) => f.startsWith(e)))
    .sort()
}

describe('MythOS never calls itself AI where a user can read it', () => {
  it('finds copy files to check at all', () => {
    // A glob that silently matches nothing would make every assertion below
    // pass for the wrong reason (#443: a check that could not run has not
    // passed).
    expect(copyFiles().length).toBeGreaterThan(50)
  })

  it('has no forbidden term in user-facing copy', () => {
    const violations: string[] = []

    for (const rel of copyFiles()) {
      const source = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
      source.split('\n').forEach((line, i) => {
        if (isLogLine(line)) return
        for (const [label, pattern] of FORBIDDEN) {
          if (pattern.test(line)) {
            violations.push(`${rel}:${i + 1} — "${label}" in: ${line.trim().slice(0, 100)}`)
          }
        }
      })
    }

    expect(violations, `The product is MythOS, not "AI". Rewrite these:\n${violations.join('\n')}`)
      .toEqual([])
  })

  it('never tells the model to describe itself as an AI', () => {
    // The highest-leverage case: a prompt string that names the concept
    // invites the model to reason about it, and the word reaches the player
    // inside narration rather than inside a label.
    const promptFiles = globSync('src/lib/{ai,downtime,game,templates}/**/*.ts', { cwd: ROOT })
      .filter((f) => !f.includes('__tests__'))

    const violations: string[] = []
    for (const rel of promptFiles) {
      const source = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
      // "you're an AI", "you are an AI", "as an AI", "AI GM", "AI Game Master"
      const selfRef = /(you(?:'re| are)\s+an?\s+AI|as an AI|\bAI\s+(?:GM|Game Master|narrator|dungeon master))/i
      source.split('\n').forEach((line, i) => {
        if (isLogLine(line)) return
        if (selfRef.test(line)) {
          violations.push(`${rel}:${i + 1} — ${line.trim().slice(0, 100)}`)
        }
      })
    }

    expect(violations, `MythOS is the game master. Rewrite these prompt strings:\n${violations.join('\n')}`)
      .toEqual([])
  })
})
