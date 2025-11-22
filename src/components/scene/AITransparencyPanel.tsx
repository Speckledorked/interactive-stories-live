// src/components/scene/AITransparencyPanel.tsx
// Shows players what world state changes the AI made during scene resolution

'use client'

import { useState } from 'react'

export interface WorldStateChange {
  category: 'character' | 'npc' | 'faction' | 'clock' | 'timeline' | 'relationship' | 'consequence'
  type: 'added' | 'modified' | 'removed' | 'ticked'
  entityName: string
  details: string
  impact?: 'minor' | 'moderate' | 'major'
}

interface AITransparencyPanelProps {
  changes: WorldStateChange[]
  sceneNumber?: number
  isOpen?: boolean
  onClose?: () => void
}

export default function AITransparencyPanel({
  changes,
  sceneNumber,
  isOpen = true,
  onClose
}: AITransparencyPanelProps) {
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    character: true,
    npc: true,
    faction: true,
    clock: true,
    timeline: true,
    relationship: true,
    consequence: true
  })

  if (!isOpen || changes.length === 0) {
    return null
  }

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => ({ ...prev, [category]: !prev[category] }))
  }

  // Group changes by category
  const groupedChanges = changes.reduce((acc, change) => {
    if (!acc[change.category]) {
      acc[change.category] = []
    }
    acc[change.category].push(change)
    return acc
  }, {} as Record<string, WorldStateChange[]>)

  // Get icon for change type
  const getChangeIcon = (type: WorldStateChange['type']) => {
    switch (type) {
      case 'added': return '➕'
      case 'modified': return '✏️'
      case 'removed': return '➖'
      case 'ticked': return '⏱️'
      default: return '•'
    }
  }

  // Get color for change category
  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'character': return 'from-green-500/20 to-green-600/10 border-green-500/50'
      case 'npc': return 'from-blue-500/20 to-blue-600/10 border-blue-500/50'
      case 'faction': return 'from-purple-500/20 to-purple-600/10 border-purple-500/50'
      case 'clock': return 'from-orange-500/20 to-orange-600/10 border-orange-500/50'
      case 'timeline': return 'from-yellow-500/20 to-yellow-600/10 border-yellow-500/50'
      case 'relationship': return 'from-pink-500/20 to-pink-600/10 border-pink-500/50'
      case 'consequence': return 'from-red-500/20 to-red-600/10 border-red-500/50'
      default: return 'from-gray-500/20 to-gray-600/10 border-gray-500/50'
    }
  }

  // Get icon for category
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'character': return '👤'
      case 'npc': return '👥'
      case 'faction': return '🏰'
      case 'clock': return '⏰'
      case 'timeline': return '📅'
      case 'relationship': return '💕'
      case 'consequence': return '⚠️'
      default: return '📝'
    }
  }

  // Get impact color
  const getImpactBadge = (impact?: 'minor' | 'moderate' | 'major') => {
    if (!impact) return null

    const config = {
      minor: { text: 'Minor', color: 'text-gray-400', bg: 'bg-gray-700/50' },
      moderate: { text: 'Moderate', color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
      major: { text: 'Major', color: 'text-red-400', bg: 'bg-red-900/30' }
    }[impact]

    return (
      <span className={`text-xs px-2 py-0.5 rounded ${config.bg} ${config.color}`}>
        {config.text}
      </span>
    )
  }

  return (
    <div className="card bg-gradient-to-br from-indigo-900/20 to-indigo-800/10 border-indigo-700/50">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <span className="text-xl">🔍</span>
          AI Changes {sceneNumber ? `(Scene ${sceneNumber})` : ''}
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        )}
      </div>

      <p className="text-sm text-gray-400 mb-4">
        The AI GM made the following changes to the world state during this scene:
      </p>

      <div className="space-y-3">
        {Object.entries(groupedChanges).map(([category, categoryChanges]) => (
          <div
            key={category}
            className={`rounded-lg border bg-gradient-to-r ${getCategoryColor(category)} overflow-hidden`}
          >
            <button
              onClick={() => toggleCategory(category)}
              className="w-full p-3 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{getCategoryIcon(category)}</span>
                <span className="font-semibold text-white capitalize">
                  {category}
                </span>
                <span className="text-xs text-gray-400">
                  ({categoryChanges.length})
                </span>
              </div>
              <span className="text-gray-400">
                {expandedCategories[category] ? '▼' : '▶'}
              </span>
            </button>

            {expandedCategories[category] && (
              <div className="p-3 pt-0 space-y-2">
                {categoryChanges.map((change, idx) => (
                  <div
                    key={idx}
                    className="bg-black/20 rounded-lg p-3 border border-white/10"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{getChangeIcon(change.type)}</span>
                        <span className="font-medium text-white text-sm">
                          {change.entityName}
                        </span>
                      </div>
                      {getImpactBadge(change.impact)}
                    </div>
                    <p className="text-sm text-gray-300 pl-6">
                      {change.details}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {changes.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <div className="text-4xl mb-2">✨</div>
          <p className="text-sm">No world state changes this scene</p>
        </div>
      )}
    </div>
  )
}
