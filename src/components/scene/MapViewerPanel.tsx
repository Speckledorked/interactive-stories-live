// src/components/scene/MapViewerPanel.tsx
// Split out of story/page.tsx's sidebar — see CharacterSelectorPanel's
// header comment for why.

'use client'

import { PlayerMapViewer } from '@/components/maps/PlayerMapViewer'
import type { MapData } from '@/lib/maps/map-service'

interface MapViewerPanelProps {
  activeMap: MapData | null
  showMap: boolean
  onToggleShowMap: () => void
  characterName: string
}

export function MapViewerPanel({ activeMap, showMap, onToggleShowMap, characterName }: MapViewerPanelProps) {
  if (!activeMap) return null

  return (
    <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium uppercase tracking-wide text-myth-ink-faint">MAP</h3>
        <button
          onClick={onToggleShowMap}
          className="text-xs text-myth-ink-faint hover:text-myth-ink transition-colors"
        >
          {showMap ? 'Hide' : 'Show'}
        </button>
      </div>
      {showMap && (
        <div className="rounded-lg overflow-hidden border border-myth-border">
          <PlayerMapViewer
            map={activeMap}
            characterName={characterName}
          />
        </div>
      )}
    </div>
  )
}
