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
    `${next.campaignIds.length} campaign(s), oracle: ${next.oracleTechnique}` +
    (next.autoMergeEligible ? ' (auto-merge eligible)' : ' (human review required)')
  )

  writeOutput('found', 'true')
  writeOutput('check_key', next.checkKey)
  writeOutput('oracle_technique', next.oracleTechnique)
  writeOutput('auto_merge_eligible', String(next.autoMergeEligible))
  writeOutput('source_files', next.sourceFiles.join(','))
  writeOutput('campaign_count', String(next.campaignIds.length))
  writeOutput('total_occurrences', String(next.totalOccurrences))
  writeOutput('evidence', JSON.stringify(next))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('check-escalations failed:', err)
    process.exit(1)
  })
