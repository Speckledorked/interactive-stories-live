// src/components/scene/RecentTimelinePanel.tsx
// Split out of story/page.tsx's sidebar — see CharacterSelectorPanel's
// header comment for why.

'use client'

import { CompactTimeline } from '@/components/scene/VisualTimeline'

interface RecentTimelinePanelProps {
  timeline: any[] | undefined
}

export function RecentTimelinePanel({ timeline }: RecentTimelinePanelProps) {
  if (!timeline || timeline.length === 0) return null

  return (
    <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-0">
      <CompactTimeline events={timeline.slice(0, 5)} />
    </div>
  )
}
