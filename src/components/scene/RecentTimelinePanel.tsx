// src/components/scene/RecentTimelinePanel.tsx
// Split out of story/page.tsx's sidebar — see CharacterSelectorPanel's
// header comment for why.

'use client'

import { useState } from 'react'
import { CompactTimeline } from '@/components/scene/VisualTimeline'
import { CollapsibleSidebarCard } from '@/components/scene/CollapsibleSidebarCard'
import { EntityStubModal } from '@/components/scene/EntityStubModal'

interface RecentTimelinePanelProps {
  timeline: any[] | undefined
  campaignId: string
}

export function RecentTimelinePanel({ timeline, campaignId }: RecentTimelinePanelProps) {
  const [selectedEvent, setSelectedEvent] = useState<any>(null)

  if (!timeline || timeline.length === 0) return null

  return (
    <CollapsibleSidebarCard title="RECENT EVENTS">
      <CompactTimeline events={timeline.slice(0, 5)} onSelectEvent={setSelectedEvent} />

      <EntityStubModal
        isOpen={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        eyebrow="Event"
        title={selectedEvent?.title || ''}
        meta={selectedEvent ? `Turn ${selectedEvent.turnNumber}` : undefined}
        body={selectedEvent?.summaryPublic || 'No summary recorded for this event.'}
        footerLinkHref={`/campaigns/${campaignId}/story-log`}
        footerLinkLabel="View full story log →"
      />
    </CollapsibleSidebarCard>
  )
}
