// src/components/scene/AITransparencyPanel.tsx
// Shows players what world state changes the AI made during scene resolution

'use client'

import { useState } from 'react'
import type { AdherenceResult } from '@/lib/game/outcomeAdherence'

export interface WorldStateChange {
  // 'roll' entries are the move-resolution receipts (see
  // lib/game/resolution.ts): the one place dice surface in the UI.
  category: 'character' | 'npc' | 'faction' | 'clock' | 'timeline' | 'relationship' | 'consequence' | 'roll'
  type: 'added' | 'modified' | 'removed' | 'ticked' | 'rolled'
  entityName: string
  details: string
  impact?: 'minor' | 'moderate' | 'major'
}

interface AITransparencyPanelProps {
  changes: WorldStateChange[]
  // #91: did the narration actually match the roll it was told was
  // binding? The check itself (checkOutcomeAdherence) already ran
  // server-side during callAIGM; this is what makes that result reach the
  // player, in the same panel that already shows the roll receipts it's
  // checking against. Absent on scenes resolved before this field existed.
  adherence?: AdherenceResult
  sceneNumber?: number
  isOpen?: boolean
  onClose?: () => void
}

export default function AITransparencyPanel({
  changes,
  adherence,
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
    consequence: true,
    // Receipts start collapsed — "behind the screen" is opt-in by design.
    roll: false
  })
  const [adherenceExpanded, setAdherenceExpanded] = useState(false)

  const hasAdherenceProblems = !!adherence && (adherence.mismatched > 0 || adherence.unreported > 0 || adherence.ambiguous > 0)

  if (!isOpen || (changes.length === 0 && !adherence)) {
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
      case 'rolled': return '🎲'
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
      case 'roll': return 'from-teal-500/20 to-teal-600/10 border-teal-500/50'
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
      case 'roll': return '🎲'
      default: return '📝'
    }
  }

  // Get impact color
  const getImpactBadge = (impact?: 'minor' | 'moderate' | 'major') => {
    if (!impact) return null

    const config = {
      minor: { text: 'Minor', color: 'text-ember-400/60', bg: 'bg-black/30' },
      moderate: { text: 'Moderate', color: 'text-ember-300', bg: 'bg-ember-900/30' },
      major: { text: 'Major', color: 'text-wine-400', bg: 'bg-wine-800/30' }
    }[impact]

    return (
      <span className={`text-xs px-2 py-0.5 rounded ${config.bg} ${config.color}`}>
        {config.text}
      </span>
    )
  }

  return (
    <div className="rounded-xl bg-gradient-to-br from-ember-900/20 to-wine-800/10 border border-ember-800/40 shadow-lg shadow-black/30 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-ember-100 flex items-center gap-2">
          <span className="text-xl">🔍</span>
          AI Changes {sceneNumber ? `(Scene ${sceneNumber})` : ''}
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-ember-300/60 hover:text-ember-100 transition-colors"
          >
            ✕
          </button>
        )}
      </div>

      <p className="text-sm text-ember-300/60 mb-4">
        The AI GM made the following changes to the world state during this scene:
      </p>

      {adherence && (adherence.matched + adherence.mismatched + adherence.unreported + adherence.ambiguous) > 0 && (
        <div
          className={`rounded-lg border mb-3 overflow-hidden ${
            hasAdherenceProblems
              ? 'bg-gradient-to-r from-wine-800/20 to-wine-900/10 border-wine-700/50'
              : 'bg-gradient-to-r from-green-500/10 to-green-600/5 border-green-600/30'
          }`}
        >
          <button
            onClick={() => setAdherenceExpanded(prev => !prev)}
            className="w-full p-3 flex items-center justify-between hover:bg-white/5 transition-colors"
            disabled={!hasAdherenceProblems}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{hasAdherenceProblems ? '⚖️' : '✓'}</span>
              <span className="font-semibold text-ember-100 text-sm">
                {hasAdherenceProblems
                  ? `Narration didn't match every roll (${adherence.matched}/${adherence.matched + adherence.mismatched} matched)`
                  : `Narration matched every roll (${adherence.matched} checked)`}
              </span>
            </div>
            {hasAdherenceProblems && (
              <span className="text-ember-400/50">{adherenceExpanded ? '▼' : '▶'}</span>
            )}
          </button>

          {hasAdherenceProblems && adherenceExpanded && (
            <div className="p-3 pt-0 space-y-2">
              {adherence.entries
                .filter(e => e.verdict !== 'match')
                .map((entry, idx) => (
                  <div key={idx} className="bg-black/25 rounded-lg p-3 border border-ember-900/20">
                    <div className="font-medium text-ember-100 text-sm mb-1">{entry.characterName}</div>
                    <p className="text-sm text-ember-200/70">
                      {entry.verdict === 'mismatch' &&
                        `The engine rolled ${entry.rolled}, but the narration read like ${entry.narrated}.`}
                      {entry.verdict === 'unreported' &&
                        `The engine rolled ${entry.rolled}, and the narrator didn't report which band it depicted.`}
                      {entry.verdict === 'ambiguous' &&
                        `Multiple rolled actions this exchange — which one the narration matches couldn't be determined.`}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

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
                <span className="font-semibold text-ember-100 capitalize">
                  {category}
                </span>
                <span className="text-xs text-ember-400/50">
                  ({categoryChanges.length})
                </span>
              </div>
              <span className="text-ember-400/50">
                {expandedCategories[category] ? '▼' : '▶'}
              </span>
            </button>

            {expandedCategories[category] && (
              <div className="p-3 pt-0 space-y-2">
                {categoryChanges.map((change, idx) => (
                  <div
                    key={idx}
                    className="bg-black/25 rounded-lg p-3 border border-ember-900/20"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{getChangeIcon(change.type)}</span>
                        <span className="font-medium text-ember-100 text-sm">
                          {change.entityName}
                        </span>
                      </div>
                      {getImpactBadge(change.impact)}
                    </div>
                    <p className="text-sm text-ember-200/70 pl-6">
                      {change.details}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {changes.length === 0 && !adherence && (
        <div className="text-center py-8 text-ember-400/50">
          <div className="text-4xl mb-2">✨</div>
          <p className="text-sm">No world state changes this scene</p>
        </div>
      )}
    </div>
  )
}
