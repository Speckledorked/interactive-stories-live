// src/components/admin/WorldStateDashboard.tsx
// Visual overview dashboard showing world state (NPCs, factions, clocks)

'use client'

import { CompactClock } from '@/components/clock/ClockProgress'

interface NPC {
  id: string
  name: string
  role: string
  status: 'alive' | 'dead' | 'unknown'
  relationship?: 'friendly' | 'neutral' | 'hostile'
  lastSeen?: string
}

interface Faction {
  id: string
  name: string
  influence: number // 0-10
  relationship?: 'allied' | 'neutral' | 'hostile'
  description?: string
}

interface Clock {
  id: string
  name: string
  current: number
  max: number
}

interface WorldStateDashboardProps {
  npcs?: NPC[]
  factions?: Faction[]
  clocks?: Clock[]
  worldNotes?: string[]
}

export default function WorldStateDashboard({
  npcs = [],
  factions = [],
  clocks = [],
  worldNotes = []
}: WorldStateDashboardProps) {

  // Get NPC status icon and color
  const getNPCStatusConfig = (status: NPC['status']) => {
    switch (status) {
      case 'alive':
        return { icon: '✓', color: 'text-green-400', bg: 'bg-green-900/30', border: 'border-green-700' }
      case 'dead':
        return { icon: '✕', color: 'text-red-400', bg: 'bg-red-900/30', border: 'border-red-700' }
      case 'unknown':
        return { icon: '?', color: 'text-gray-400', bg: 'bg-gray-900/30', border: 'border-gray-700' }
    }
  }

  // Get relationship badge
  const getRelationshipBadge = (relationship?: 'friendly' | 'neutral' | 'hostile' | 'allied') => {
    if (!relationship) return null

    const config = {
      friendly: { text: '🤝 Friendly', color: 'text-green-400', bg: 'bg-green-900/30' },
      allied: { text: '⚔️ Allied', color: 'text-blue-400', bg: 'bg-blue-900/30' },
      neutral: { text: '○ Neutral', color: 'text-gray-400', bg: 'bg-gray-900/30' },
      hostile: { text: '⚡ Hostile', color: 'text-red-400', bg: 'bg-red-900/30' }
    }[relationship]

    return (
      <span className={`text-xs px-2 py-0.5 rounded ${config.bg} ${config.color}`}>
        {config.text}
      </span>
    )
  }

  // Get influence bar color
  const getInfluenceColor = (influence: number) => {
    if (influence >= 8) return 'from-purple-500 to-purple-600'
    if (influence >= 6) return 'from-blue-500 to-blue-600'
    if (influence >= 4) return 'from-yellow-500 to-yellow-600'
    return 'from-gray-500 to-gray-600'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          🌍 World State Dashboard
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* NPCs Section */}
        <div className="card bg-gradient-to-br from-blue-900/20 to-blue-800/10 border-blue-700/50">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            👥 NPCs ({npcs.length})
          </h3>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {npcs.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No NPCs tracked yet</p>
            ) : (
              npcs.map((npc) => {
                const statusConfig = getNPCStatusConfig(npc.status)
                return (
                  <div
                    key={npc.id}
                    className={`p-3 rounded-lg border ${statusConfig.border} ${statusConfig.bg} hover:scale-[1.02] transition-all`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-sm font-semibold ${statusConfig.color}`}>
                            {statusConfig.icon}
                          </span>
                          <h4 className="font-semibold text-white">{npc.name}</h4>
                        </div>
                        <p className="text-xs text-gray-400">{npc.role}</p>
                        {npc.lastSeen && (
                          <p className="text-xs text-gray-500 mt-1">Last seen: {npc.lastSeen}</p>
                        )}
                      </div>
                      {getRelationshipBadge(npc.relationship)}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Factions Section */}
        <div className="card bg-gradient-to-br from-purple-900/20 to-purple-800/10 border-purple-700/50">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            🏰 Factions ({factions.length})
          </h3>

          <div className="space-y-3 max-h-96 overflow-y-auto">
            {factions.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No factions tracked yet</p>
            ) : (
              factions.map((faction) => (
                <div
                  key={faction.id}
                  className="p-3 rounded-lg border border-purple-700/50 bg-purple-900/20 hover:scale-[1.02] transition-all"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h4 className="font-semibold text-white">{faction.name}</h4>
                    {getRelationshipBadge(faction.relationship)}
                  </div>

                  {faction.description && (
                    <p className="text-xs text-gray-400 mb-2">{faction.description}</p>
                  )}

                  {/* Influence bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">Influence</span>
                      <span className="text-gray-300 font-semibold">{faction.influence}/10</span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden border border-gray-700">
                      <div
                        className={`h-full bg-gradient-to-r ${getInfluenceColor(faction.influence)} transition-all duration-500`}
                        style={{ width: `${(faction.influence / 10) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Active Clocks Section */}
        <div className="card bg-gradient-to-br from-orange-900/20 to-orange-800/10 border-orange-700/50">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            ⏰ Active Clocks ({clocks.length})
          </h3>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {clocks.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No active clocks</p>
            ) : (
              clocks.map((clock) => (
                <CompactClock
                  key={clock.id}
                  name={clock.name}
                  current={clock.current}
                  max={clock.max}
                />
              ))
            )}
          </div>
        </div>

        {/* World Notes Section */}
        <div className="card bg-gradient-to-br from-gray-900/40 to-gray-800/20 border-gray-700">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            📝 World Notes ({worldNotes.length})
          </h3>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {worldNotes.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No world notes yet</p>
            ) : (
              worldNotes.map((note, index) => (
                <div
                  key={index}
                  className="p-3 rounded-lg border border-gray-700 bg-gray-800/50 hover:bg-gray-800/70 transition-all"
                >
                  <p className="text-sm text-gray-300">{note}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card bg-gradient-to-br from-green-900/20 to-green-800/10 border-green-700/50 text-center">
          <div className="text-3xl font-bold text-green-400">{npcs.filter(n => n.status === 'alive').length}</div>
          <div className="text-xs text-gray-400 mt-1">Active NPCs</div>
        </div>

        <div className="card bg-gradient-to-br from-purple-900/20 to-purple-800/10 border-purple-700/50 text-center">
          <div className="text-3xl font-bold text-purple-400">{factions.length}</div>
          <div className="text-xs text-gray-400 mt-1">Factions</div>
        </div>

        <div className="card bg-gradient-to-br from-orange-900/20 to-orange-800/10 border-orange-700/50 text-center">
          <div className="text-3xl font-bold text-orange-400">{clocks.filter(c => c.current >= c.max * 0.75).length}</div>
          <div className="text-xs text-gray-400 mt-1">Critical Clocks</div>
        </div>

        <div className="card bg-gradient-to-br from-blue-900/20 to-blue-800/10 border-blue-700/50 text-center">
          <div className="text-3xl font-bold text-blue-400">{worldNotes.length}</div>
          <div className="text-xs text-gray-400 mt-1">Notes</div>
        </div>
      </div>
    </div>
  )
}
