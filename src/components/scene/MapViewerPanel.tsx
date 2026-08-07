// src/components/scene/MapViewerPanel.tsx
// Split out of story/page.tsx's sidebar — see CharacterSelectorPanel's
// header comment for why.

'use client'

import { PlayerMapViewer } from '@/components/maps/PlayerMapViewer'
import { CollapsibleSidebarCard } from '@/components/scene/CollapsibleSidebarCard'
import type { MapData } from '@/lib/maps/map-service'

interface MapViewerPanelProps {
  activeMap: MapData | null
  characterName: string
}

export function MapViewerPanel({ activeMap, characterName }: MapViewerPanelProps) {
  if (!activeMap) return null

  return (
    <CollapsibleSidebarCard title="MAP" defaultOpen={false}>
      <div className="rounded-lg overflow-hidden border border-myth-border">
        <PlayerMapViewer
          map={activeMap}
          characterName={characterName}
        />
      </div>
    </CollapsibleSidebarCard>
  )
}
