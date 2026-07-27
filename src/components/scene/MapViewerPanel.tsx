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
    <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-ember-300/60">MAP</h3>
        <button
          onClick={onToggleShowMap}
          className="text-xs text-ember-400/50 hover:text-ember-100 transition-colors"
        >
          {showMap ? 'Hide' : 'Show'}
        </button>
      </div>
      {showMap && (
        <div className="rounded-lg overflow-hidden border border-ember-900/30">
          <PlayerMapViewer
            map={activeMap}
            characterName={characterName}
          />
        </div>
      )}
    </div>
  )
}
