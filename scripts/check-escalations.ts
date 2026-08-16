// scripts/check-escalations.ts
// Phase 5 CI entrypoint (plan section 5b/5g) — the deterministic,
// AI-free "is anything actually wrong" gate a scheduled GitHub Actions
// workflow runs BEFORE ever invoking a coding agent. All the real logic
// lives in src/lib/game/integrity/escalationAggregation.ts (unit-tested);
// this is just the CLI wrapper that talks to $GITHUB_OUTPUT.
//
// Picks at most ONE checkKey per run (the highest total occurrence count)
// deliberately — every downstream step (agent invocation, verification,
// PR) stays scoped to one bug at a time, rather than reasoning about
// several unrelated ones in a single pass. A checkKey left unpicked this
// run is still there next run; nothing about this drops it.

import { prisma } from '../src/lib/prisma'
import { findActionableEscalations } from '../src/lib/game/integrity/escalationAggregation'
import { appendFileSync } from 'fs'

function writeOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT
  if (file) {
    appendFileSync(file, `${name}<<EOF\n${value}\nEOF\n`)
  } else {
    console.log(`[output] ${name}=${value}`)
  }
}

/**
 * #394: counts and identifiers only — no player- or AI-authored text.
 *
 * checkKey and oracleTechnique are drawn from closed registries
 * (integrity/checkKeys.ts, oracleTechnique.ts). sourceFiles come from
 * escalationSourceMap.ts, a hardcoded map. Ids are cuids. Nothing here can
 * carry a sentence somebody wrote.
 */
function sanitizeEvidence(escalation: {
  checkKey: string
  oracleTechnique: string
  sourceFiles: readonly string[]
  campaignIds: readonly string[]
  totalOccurrences: number
}): Record<string, unknown> {
  return {
    checkKey: escalation.checkKey,
    oracleTechnique: escalation.oracleTechnique,
    sourceFiles: [...escalation.sourceFiles],
    campaignCount: escalation.campaignIds.length,
    totalOccurrences: escalation.totalOccurrences,
  }
}

async function main() {
  const escalations = await findActionableEscalations(prisma)

  if (escalations.length === 0) {
    console.log('No actionable escalations found.')
    writeOutput('found', 'false')
    return
  }

  const next = [...escalations].sort((a, b) => b.totalOccurrences - a.totalOccurrences)[0]
  console.log(
    `Actionable: ${next.checkKey} — ${next.totalOccurrences} occurrence(s) across ` +
    `${next.campaignIds.length} campaign(s), oracle: ${next.oracleTechnique}`
  )

  writeOutput('found', 'true')
  writeOutput('check_key', next.checkKey)
  writeOutput('oracle_technique', next.oracleTechnique)
  writeOutput('source_files', next.sourceFiles.join(','))
  writeOutput('campaign_count', String(next.campaignIds.length))
  writeOutput('total_occurrences', String(next.totalOccurrences))
  // #394: the evidence payload is NOT free-text-safe.
  //
  // `next.sample` is a Violation carrying entityName and description —
  // i.e. NPC, faction and character names written by PLAYERS and by the AI
  // in real campaigns. That string is spliced with ${{ }} straight into
  // the agent prompt in integrity-autofix.yml, which now runs daily with
  // no human gate and ends in `gh pr merge --auto --squash`. Any
  // self-signed-up user could name an NPC to plant text there.
  //
  // The workflow header describes at length how the SHELL injection of
  // this same data was fixed by routing it through `env:`; the PROMPT
  // injection was untouched. Shell-escaping the value never addressed the
  // problem, because the model is an interpreter too.
  //
  // The fix is not to escape it better — it is that entity names buy the
  // agent nothing an id doesn't. What a diagnosing agent needs is WHICH
  // check fired, HOW OFTEN, and WHERE; all of that is already emitted
  // above as separate, structurally-constrained outputs. So the evidence
  // is reduced to counts and identifiers with no free text at all.
  writeOutput('evidence', JSON.stringify(sanitizeEvidence(next)))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('check-escalations failed:', err)
    process.exit(1)
  })
