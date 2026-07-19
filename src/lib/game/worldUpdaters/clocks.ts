// src/lib/game/worldUpdaters/clocks.ts
// Domain applier for world_updates.clock_changes. See README Known Bugs P1
// (stateUpdater decomposition, #4/#41).

import { Prisma, Clock } from '@prisma/client'
import type { WorldUpdates } from '@/lib/ai/schema'
import { resolveEntityByNameOrId } from '../entityResolution'

type Db = Prisma.TransactionClient
export type ClockChange = NonNullable<WorldUpdates['clock_changes']>[number]

export async function applyClockChanges(
  tx: Db,
  clockChanges: ClockChange[],
  clocksForResolution: Clock[]
): Promise<void> {
  console.log(`⏰ Updating ${clockChanges.length} clocks`)

  for (const clockChange of clockChanges) {
    const resolution = resolveEntityByNameOrId(clocksForResolution, clockChange.clock_name_or_id)
    const clock = resolution.kind === 'found' ? resolution.entity : null
    if (resolution.kind === 'ambiguous') {
      console.warn(`  ⚠️ Ambiguous clock name "${clockChange.clock_name_or_id}" — matches ${resolution.candidates.map(c => c.name).join(', ')}, skipping rather than guessing`)
    }

    if (clock) {
      const newTicks = Math.max(0, Math.min(
        clock.currentTicks + clockChange.delta,
        clock.maxTicks
      ))

      await tx.clock.update({
        where: { id: clock.id },
        data: { currentTicks: newTicks }
      })

      console.log(`  ⏰ ${clock.name}: ${clock.currentTicks} → ${newTicks}`)
    } else {
      console.warn(`  ⚠️ Clock not found: ${clockChange.clock_name_or_id}`)
    }
  }
}
