// src/components/scene/AITransparencyPanel.tsx
// Shows players what world state changes the AI made during scene resolution

'use client'

import { useState } from 'react'
import type { AdherenceResult } from '@/lib/game/outcomeAdherence'
import type { MoveVarietyResult } from '@/lib/game/moveVariety'
import { IconButton } from '@/components/ui/icon-button'
import { X } from 'lucide-react'
import { UI_ICONS } from '@/lib/ui/icons'
import { AlertTriangle, CalendarDays, Castle, Clock, Dices, Dot, HeartHandshake, Feather, Minus, Pencil, Plus, Repeat, Scale, Timer, User, Users } from 'lucide-react'
import { type IconComponent } from '@/lib/ui/icons'

export interface WorldStateChange {
  // 'roll' entries are the move-resolution receipts (see
  // lib/game/resolution.ts): the one place dice surface in the UI.
  category: 'character' | 'npc' | 'faction' | 'clock' | 'timeline' | 'relationship' | 'consequence' | 'roll'
  // 'failed' is honest about a reported change that never landed — e.g. a
  // pc_changes entry whose character_name_or_id didn't match anyone on the
  // roster — rather than mislabeling a no-op as 'modified'.
  type: 'added' | 'modified' | 'removed' | 'ticked' | 'rolled' | 'failed'
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
  // #232: which move (from MECHANICAL_OUTCOMES's weakHit/miss menus) the
  // narrator actually reported using each exchange, and whether it
  // repeated one already used earlier this scene — same "measurement,
  // never enforcement" posture as adherence above. Absent on scenes
  // resolved before this field existed.
  moveVariety?: MoveVarietyResult
  sceneNumber?: number
  isOpen?: boolean
  onClose?: () => void
}

export default function AITransparencyPanel({
  changes,
  adherence,
  moveVariety,
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
  const hasMoveRepeats = !!moveVariety && moveVariety.repeated > 0
  const [moveVarietyExpanded, setMoveVarietyExpanded] = useState(false)

  if (!isOpen || (changes.length === 0 && !adherence && !moveVariety)) {
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

  // Change-type and category icons. Both return a component rather than
  // a glyph so they inherit currentColor and sit on the text baseline —
  // the emoji they replaced did neither.
  const getChangeIcon = (type: WorldStateChange['type']): IconComponent => {
    switch (type) {
      case 'added': return Plus
      case 'modified': return Pencil
      case 'removed': return Minus
      case 'ticked': return Timer
      case 'rolled': return Dices
      case 'failed': return AlertTriangle
      default: return Dot
    }
  }

  const getCategoryIcon = (category: string): IconComponent => {
    switch (category) {
      case 'character': return User
      case 'npc': return Users
      case 'faction': return Castle
      case 'clock': return Clock
      case 'timeline': return CalendarDays
      case 'relationship': return HeartHandshake
      case 'consequence': return AlertTriangle
      case 'roll': return Dices
      default: return Feather
    }
  }

  // Display label for a category — 'clock' shows as "thread" (see the
  // Clocks->Threads rename); every other category already reads fine as
  // its own raw key.
  const getCategoryLabel = (category: string) => (category === 'clock' ? 'thread' : category)

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
          <UI_ICONS.reveal className="h-5 w-5 flex-shrink-0" />
          AI Changes {sceneNumber ? `(Scene ${sceneNumber})` : ''}
        </h3>
        {onClose && (
          <IconButton icon={X} label="Close AI changes" size="sm" onClick={onClose} />
        )}
      </div>

      <p className="text-sm text-myth-ink-muted mb-4">
        MythOS made the following changes to the world state during this scene:
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
              {hasAdherenceProblems ? <Scale className="h-4 w-4 flex-shrink-0" /> : <UI_ICONS.success className="h-4 w-4 flex-shrink-0" />}
              <span className="font-medium text-myth-ink text-sm">
                {hasAdherenceProblems
                  ? `Narration didn't match every roll (${adherence.matched}/${adherence.matched + adherence.mismatched + adherence.unreported + adherence.ambiguous} matched)`
                  : `Narration matched every roll (${adherence.matched} checked)`}
              </span>
            </div>
            {hasAdherenceProblems && (
              adherenceExpanded ? (
                <UI_ICONS.expanded className="h-4 w-4 text-myth-ink-faint" />
              ) : (
                <UI_ICONS.collapsed className="h-4 w-4 text-myth-ink-faint" />
              )
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

      {moveVariety && (moveVariety.reported + moveVariety.unreported) > 0 && (
        <div
          className={`rounded-lg border mb-3 overflow-hidden ${
            hasMoveRepeats
              ? 'bg-myth-warn/10 border-myth-warn/30'
              : 'bg-myth-good/10 border-myth-good/30'
          }`}
        >
          <button
            onClick={() => setMoveVarietyExpanded(prev => !prev)}
            className="w-full p-3 flex items-center justify-between hover:bg-myth-surface-sunken transition-colors"
            disabled={!hasMoveRepeats}
          >
            <div className="flex items-center gap-2">
              {hasMoveRepeats ? <Repeat className="h-4 w-4 flex-shrink-0" /> : <UI_ICONS.success className="h-4 w-4 flex-shrink-0" />}
              <span className="font-medium text-myth-ink text-sm">
                {hasMoveRepeats
                  ? `Repeated a move already used this scene (${moveVariety.repeated}/${moveVariety.reported + moveVariety.unreported})`
                  : `Varied its moves this scene (${moveVariety.reported} tracked)`}
              </span>
            </div>
            {hasMoveRepeats && (
              moveVarietyExpanded ? (
                <UI_ICONS.expanded className="h-4 w-4 text-myth-ink-faint" />
              ) : (
                <UI_ICONS.collapsed className="h-4 w-4 text-myth-ink-faint" />
              )
            )}
          </button>

          {hasMoveRepeats && moveVarietyExpanded && (
            <div className="p-3 pt-0 space-y-2">
              {moveVariety.entries
                .filter(e => e.repeatsRecent)
                .map((entry, idx) => (
                  <div key={idx} className="bg-myth-surface-sunken rounded-lg p-3 border border-myth-border">
                    <div className="font-medium text-myth-ink text-sm mb-1">{entry.characterName}</div>
                    <p className="text-sm text-myth-ink-muted">
                      Reached for &ldquo;{entry.normalizedMove}&rdquo; again — already used earlier this scene.
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
              {(() => { const I = getCategoryIcon(category); return <I className="h-4 w-4 flex-shrink-0" /> })()}
              <span className="text-sm font-medium uppercase tracking-wide text-myth-ink-muted">
                {getCategoryLabel(category)}
              </span>
              <span className="text-xs text-myth-ink-faint">
                ({categoryChanges.length})
              </span>
              <span className="ml-auto text-myth-ink-faint">
                {(() => { const I = expandedCategories[category] ? UI_ICONS.expanded : UI_ICONS.collapsed; return <I className="h-4 w-4" /> })()}
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
                        {(() => { const I = getChangeIcon(change.type); return <I className="h-3.5 w-3.5 flex-shrink-0" /> })()}
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

      {changes.length === 0 && !adherence && !moveVariety && (
        <div className="text-center py-8 text-myth-ink-faint">
          <UI_ICONS.info className="mx-auto mb-2 h-8 w-8 text-myth-ink-faint" />
          <p className="text-sm">No world state changes this scene</p>
        </div>
      )}
    </div>
  )
}
