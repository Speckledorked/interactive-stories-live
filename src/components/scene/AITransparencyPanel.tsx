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

  // Get impact badge — the one place per-change color legitimately
  // carries meaning (severity), on real semantic tokens.
  const getImpactBadge = (impact?: 'minor' | 'moderate' | 'major') => {
    if (!impact) return null

    const config = {
      minor: { text: 'Minor', color: 'text-myth-ink-faint', bg: 'bg-myth-surface-sunken' },
      moderate: { text: 'Moderate', color: 'text-myth-warn', bg: 'bg-myth-warn/10' },
      major: { text: 'Major', color: 'text-myth-danger', bg: 'bg-myth-danger/10' }
    }[impact]

    return (
      <span className={`text-xs px-2 py-0.5 rounded ${config.bg} ${config.color}`}>
        {config.text}
      </span>
    )
  }

  return (
    <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg text-myth-ink flex items-center gap-2">
          <span className="text-xl">🔍</span>
          AI Changes {sceneNumber ? `(Scene ${sceneNumber})` : ''}
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-myth-ink-faint hover:text-myth-ink transition-colors"
          >
            ✕
          </button>
        )}
      </div>

      <p className="text-sm text-myth-ink-muted mb-4">
        The AI GM made the following changes to the world state during this scene:
      </p>

      {adherence && (adherence.matched + adherence.mismatched + adherence.unreported + adherence.ambiguous) > 0 && (
        <div
          className={`rounded-lg border mb-3 overflow-hidden ${
            hasAdherenceProblems
              ? 'bg-myth-danger/10 border-myth-danger/30'
              : 'bg-myth-good/10 border-myth-good/30'
          }`}
        >
          <button
            onClick={() => setAdherenceExpanded(prev => !prev)}
            className="w-full p-3 flex items-center justify-between hover:bg-myth-surface-sunken transition-colors"
            disabled={!hasAdherenceProblems}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{hasAdherenceProblems ? '⚖️' : '✓'}</span>
              <span className="font-medium text-myth-ink text-sm">
                {hasAdherenceProblems
                  ? `Narration didn't match every roll (${adherence.matched}/${adherence.matched + adherence.mismatched + adherence.unreported + adherence.ambiguous} matched)`
                  : `Narration matched every roll (${adherence.matched} checked)`}
              </span>
            </div>
            {hasAdherenceProblems && (
              <span className="text-myth-ink-faint">{adherenceExpanded ? '▼' : '▶'}</span>
            )}
          </button>

          {hasAdherenceProblems && adherenceExpanded && (
            <div className="p-3 pt-0 space-y-2">
              {adherence.entries
                .filter(e => e.verdict !== 'match')
                .map((entry, idx) => (
                  <div key={idx} className="bg-myth-surface-sunken rounded-lg p-3 border border-myth-border">
                    <div className="font-medium text-myth-ink text-sm mb-1">{entry.characterName}</div>
                    <p className="text-sm text-myth-ink-muted">
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

      <div>
        {Object.entries(groupedChanges).map(([category, categoryChanges]) => (
          <div key={category}>
            <button
              onClick={() => toggleCategory(category)}
              className="w-full flex items-center gap-2 py-2 border-b border-myth-border hover:text-myth-ink transition-colors"
            >
              <span className="text-lg">{getCategoryIcon(category)}</span>
              <span className="text-sm font-medium uppercase tracking-wide text-myth-ink-muted">
                {category}
              </span>
              <span className="text-xs text-myth-ink-faint">
                ({categoryChanges.length})
              </span>
              <span className="ml-auto text-myth-ink-faint">
                {expandedCategories[category] ? '▼' : '▶'}
              </span>
            </button>

            {expandedCategories[category] && (
              <div>
                {categoryChanges.map((change, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-2 py-2 border-b border-myth-border/50 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{getChangeIcon(change.type)}</span>
                        <span className="font-medium text-myth-ink text-sm">
                          {change.entityName}
                        </span>
                      </div>
                      <p className="text-sm text-myth-ink-muted ml-6">
                        {change.details}
                      </p>
                    </div>
                    {getImpactBadge(change.impact)}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {changes.length === 0 && !adherence && (
        <div className="text-center py-8 text-myth-ink-faint">
          <div className="text-4xl mb-2">✨</div>
          <p className="text-sm">No world state changes this scene</p>
        </div>
      )}
    </div>
  )
}
