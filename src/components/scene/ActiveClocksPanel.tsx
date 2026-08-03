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
    <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
      <h3 className="text-sm font-medium uppercase tracking-wide text-myth-ink-faint mb-3">ACTIVE CLOCKS</h3>
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
