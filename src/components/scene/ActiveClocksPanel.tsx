// src/components/scene/ActiveClocksPanel.tsx
// Split out of story/page.tsx's sidebar — see CharacterSelectorPanel's
// header comment for why.

'use client'

import { useState } from 'react'
import { CompactClock } from '@/components/clock/ClockProgress'
import { CollapsibleSidebarCard } from '@/components/scene/CollapsibleSidebarCard'
import { EntityStubModal } from '@/components/scene/EntityStubModal'

interface ActiveClocksPanelProps {
  clocks: any[] | undefined
  campaignId: string
}

export function ActiveClocksPanel({ clocks, campaignId }: ActiveClocksPanelProps) {
  const [selectedClock, setSelectedClock] = useState<any>(null)

  // A clock that reached maxTicks is done — its consequence has already
  // fired (see Clock.resolvedAt's schema comment) or is about to on the
  // next tick, and nothing ever advances it further. Filtered before the
  // empty check below so a scene whose clocks are ALL complete shows no
  // panel at all, instead of an empty "ACTIVE CLOCKS" header over nothing.
  const visibleClocks = (clocks ?? []).filter(
    (clock: any) => !clock.isHidden && clock.currentTicks < clock.maxTicks
  )

  if (visibleClocks.length === 0) return null

  return (
    <CollapsibleSidebarCard title="ACTIVE CLOCKS">
      <div className="space-y-2">
        {visibleClocks.map((clock: any) => (
          <button
            key={clock.id}
            onClick={() => setSelectedClock(clock)}
            className="w-full text-left"
          >
            <CompactClock
              name={clock.name}
              current={clock.currentTicks}
              max={clock.maxTicks}
            />
          </button>
        ))}
      </div>

      <EntityStubModal
        isOpen={!!selectedClock}
        onClose={() => setSelectedClock(null)}
        eyebrow="Thread"
        title={selectedClock?.name || ''}
        meta={selectedClock ? `${selectedClock.currentTicks}/${selectedClock.maxTicks} ticks` : undefined}
        body={
          [selectedClock?.description, selectedClock?.consequence ? `When complete: ${selectedClock.consequence}` : null]
            .filter(Boolean)
            .join('\n\n') || 'No further details recorded for this clock yet.'
        }
        footerLinkHref={`/campaigns/${campaignId}/wiki?type=CLOCK`}
        footerLinkLabel="View all clocks in wiki"
      />
    </CollapsibleSidebarCard>
  )
}
