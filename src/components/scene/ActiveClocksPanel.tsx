// src/components/scene/ActiveClocksPanel.tsx
// Split out of story/page.tsx's sidebar — see CharacterSelectorPanel's
// header comment for why.

'use client'

import { CompactClock } from '@/components/clock/ClockProgress'

interface ActiveClocksPanelProps {
  clocks: any[] | undefined
}

export function ActiveClocksPanel({ clocks }: ActiveClocksPanelProps) {
  if (!clocks || clocks.length === 0) return null

  return (
    <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
      <h3 className="text-sm font-bold text-ember-300/60 mb-3">ACTIVE CLOCKS</h3>
      <div className="space-y-2">
        {clocks
          .filter((clock: any) => !clock.isHidden)
          .map((clock: any) => (
            <CompactClock
              key={clock.id}
              name={clock.name}
              current={clock.currentTicks}
              max={clock.maxTicks}
            />
          ))}
      </div>
    </div>
  )
}
