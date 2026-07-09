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
        return { icon: '✓', color: 'text-success-400', bg: 'bg-success-500/10', border: 'border-success-500/30' }
      case 'dead':
        return { icon: '✕', color: 'text-wine-400', bg: 'bg-wine-800/20', border: 'border-wine-700/40' }
      case 'unknown':
        return { icon: '?', color: 'text-ember-400/60', bg: 'bg-black/25', border: 'border-ember-900/30' }
    }
  }

  // Get relationship badge
  const getRelationshipBadge = (relationship?: 'friendly' | 'neutral' | 'hostile' | 'allied') => {
    if (!relationship) return null

    const config = {
      friendly: { text: '🤝 Friendly', color: 'text-success-400', bg: 'bg-success-500/10' },
      allied: { text: '⚔️ Allied', color: 'text-ember-300', bg: 'bg-ember-900/20' },
      neutral: { text: '○ Neutral', color: 'text-ember-400/60', bg: 'bg-black/25' },
      hostile: { text: '⚡ Hostile', color: 'text-wine-400', bg: 'bg-wine-800/20' }
    }[relationship]

    return (
      <span className={`text-xs px-2 py-0.5 rounded ${config.bg} ${config.color}`}>
        {config.text}
      </span>
    )
  }

  // Get influence bar color
  const getInfluenceColor = (influence: number) => {
    if (influence >= 8) return 'from-wine-500 to-wine-700'
    if (influence >= 6) return 'from-ember-400 to-ember-600'
    if (influence >= 4) return 'from-ember-600 to-ember-800'
    return 'from-ember-800 to-ember-900'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-ember-100 flex items-center gap-2">
          🌍 World State Dashboard
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* NPCs Section */}
        <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
          <h3 className="text-lg font-bold text-ember-100 mb-4 flex items-center gap-2">
            👥 NPCs ({npcs.length})
          </h3>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {npcs.length === 0 ? (
              <p className="text-sm text-ember-400/50 italic">No NPCs tracked yet</p>
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
                          <h4 className="font-semibold text-ember-100">{npc.name}</h4>
                        </div>
                        <p className="text-xs text-ember-300/60">{npc.role}</p>
                        {npc.lastSeen && (
                          <p className="text-xs text-ember-400/50 mt-1">Last seen: {npc.lastSeen}</p>
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
        <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-wine-800/10 border border-wine-800/30 shadow-lg shadow-black/30 p-5">
          <h3 className="text-lg font-bold text-ember-100 mb-4 flex items-center gap-2">
            🏰 Factions ({factions.length})
          </h3>

          <div className="space-y-3 max-h-96 overflow-y-auto">
            {factions.length === 0 ? (
              <p className="text-sm text-ember-400/50 italic">No factions tracked yet</p>
            ) : (
              factions.map((faction) => (
                <div
                  key={faction.id}
                  className="p-3 rounded-lg border border-wine-800/30 bg-wine-800/10 hover:scale-[1.02] transition-all"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h4 className="font-semibold text-ember-100">{faction.name}</h4>
                    {getRelationshipBadge(faction.relationship)}
                  </div>

                  {faction.description && (
                    <p className="text-xs text-ember-300/60 mb-2">{faction.description}</p>
                  )}

                  {/* Influence bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-ember-400/50">Influence</span>
                      <span className="text-ember-200/70 font-semibold">{faction.influence}/10</span>
                    </div>
                    <div className="h-2 bg-black/30 rounded-full overflow-hidden border border-ember-900/30">
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
        <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-ember-900/10 border border-ember-800/30 shadow-lg shadow-black/30 p-5">
          <h3 className="text-lg font-bold text-ember-100 mb-4 flex items-center gap-2">
            ⏰ Active Clocks ({clocks.length})
          </h3>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {clocks.length === 0 ? (
              <p className="text-sm text-ember-400/50 italic">No active clocks</p>
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
        <div className="rounded-xl bg-gradient-to-br from-black/30 to-tavern-900/40 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
          <h3 className="text-lg font-bold text-ember-100 mb-4 flex items-center gap-2">
            📝 World Notes ({worldNotes.length})
          </h3>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {worldNotes.length === 0 ? (
              <p className="text-sm text-ember-400/50 italic">No world notes yet</p>
            ) : (
              worldNotes.map((note, index) => (
                <div
                  key={index}
                  className="p-3 rounded-lg border border-ember-900/30 bg-black/25 hover:bg-black/35 transition-all"
                >
                  <p className="text-sm text-ember-200/70">{note}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl bg-black/25 border border-success-500/20 shadow-lg shadow-black/30 p-5 text-center">
          <div className="text-3xl font-bold text-success-400">{npcs.filter(n => n.status === 'alive').length}</div>
          <div className="text-xs text-ember-400/50 mt-1">Active NPCs</div>
        </div>

        <div className="rounded-xl bg-black/25 border border-wine-800/30 shadow-lg shadow-black/30 p-5 text-center">
          <div className="text-3xl font-bold text-ember-300">{factions.length}</div>
          <div className="text-xs text-ember-400/50 mt-1">Factions</div>
        </div>

        <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-ember-900/10 border border-ember-800/30 shadow-lg shadow-black/30 p-5 text-center">
          <div className="text-3xl font-bold text-wine-400">{clocks.filter(c => c.current >= c.max * 0.75).length}</div>
          <div className="text-xs text-ember-400/50 mt-1">Critical Clocks</div>
        </div>

        <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5 text-center">
          <div className="text-3xl font-bold text-ember-300">{worldNotes.length}</div>
          <div className="text-xs text-ember-400/50 mt-1">Notes</div>
        </div>
      </div>
    </div>
  )
}
