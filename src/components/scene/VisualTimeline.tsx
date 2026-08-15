// src/components/scene/VisualTimeline.tsx
// Enhanced visual timeline with better design

'use client'

import { useState } from 'react'
import SceneMoodTag, { detectSceneMood } from './SceneMoodTag'
import { Button } from '@/components/ui/button'
import { UI_ICONS } from '@/lib/ui/icons'
import { BookOpen } from 'lucide-react'

interface TimelineEvent {
  id: string
  sceneNumber?: number
  turnNumber: number
  title: string
  summary: string
  sceneIntroText?: string
  sceneResolutionText?: string
  createdAt: Date
  status?: string
}

interface VisualTimelineProps {
  events: TimelineEvent[]
  compact?: boolean
}

export default function VisualTimeline({ events, compact = false }: VisualTimelineProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (events.length === 0) {
    return (
      <div className="text-center py-16">
        <BookOpen className="mx-auto mb-4 h-12 w-12 text-myth-ink-faint" />
        <p className="text-xl text-myth-ink mb-2">Your story begins here</p>
        <p className="text-sm text-myth-ink-faint">Events will appear as your adventure unfolds</p>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-6 md:left-12 top-0 bottom-0 w-1 bg-gradient-to-b from-myth-accent via-myth-accent to-transparent" />

      {/* Events */}
      <div className="space-y-8">
        {events.map((event, index) => {
          const isExpanded = expandedId === event.id
          const sceneText = event.sceneIntroText || event.sceneResolutionText || event.summary
          const moods = detectSceneMood(sceneText)

          return (
            <div key={event.id} className="relative pl-16 md:pl-24">
              {/* Timeline dot */}
              <div className="absolute left-3 md:left-9 top-0 w-6 h-6 rounded-full bg-myth-accent border-4 border-myth-canvas shadow-lg shadow-myth-accent/50 flex items-center justify-center">
                {index === 0 && <div className="w-2 h-2 rounded-full bg-myth-canvas animate-pulse" />}
              </div>

              {/* Event card */}
              <div
                className={`
                  rounded-xl bg-myth-surface border border-myth-border shadow-lg shadow-black/30 p-5
                  hover:border-myth-border-strong transition-all duration-300
                  cursor-pointer
                  ${isExpanded ? 'ring-2 ring-myth-accent' : ''}
                `}
                onClick={() => setExpandedId(isExpanded ? null : event.id)}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      {event.sceneNumber && (
                        <div className="bg-myth-surface-sunken border border-myth-border rounded-full px-3 py-1 text-xs font-bold text-myth-ink-muted">
                          Scene {event.sceneNumber}
                        </div>
                      )}
                      <div className="text-xs text-myth-ink-faint">
                        Turn {event.turnNumber}
                      </div>
                    </div>
                    <h3 className="text-lg font-bold text-myth-ink mb-2">{event.title}</h3>

                    {/* Mood tags */}
                    {moods.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {moods.slice(0, 2).map((mood, i) => (
                          <SceneMoodTag key={i} mood={mood} size="sm" />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Status badge */}
                  {event.status && (
                    <div className={`
                      px-3 py-1 rounded-full text-xs font-medium
                      ${event.status === 'COMPLETED'
                        ? 'bg-success-500/20 text-success-400 border border-success-500/40'
                        : event.status === 'AWAITING_ACTIONS'
                          ? 'bg-myth-surface-sunken text-myth-ink-muted border border-myth-border-strong'
                          : 'bg-myth-surface-sunken text-myth-ink-faint border border-myth-border'
                      }
                    `}>
                      {event.status.replace('_', ' ')}
                    </div>
                  )}
                </div>

                {/* Summary */}
                <p className={`text-myth-ink text-sm ${compact && !isExpanded ? 'line-clamp-2' : ''}`}>
                  {event.summary}
                </p>

                {/* Expanded content */}
                {isExpanded && event.sceneIntroText && (
                  <div className="mt-4 pt-4 border-t border-myth-border">
                    <p className="text-sm text-myth-ink-faint mb-2 font-semibold">Scene Introduction:</p>
                    <p className="text-myth-ink text-sm whitespace-pre-wrap bg-myth-surface-sunken p-3 rounded border border-myth-border">
                      {event.sceneIntroText}
                    </p>
                  </div>
                )}

                {/* Metadata */}
                <div className="mt-4 flex items-center justify-between text-xs text-myth-ink-faint">
                  <span>{new Date(event.createdAt).toLocaleDateString()} at {new Date(event.createdAt).toLocaleTimeString()}</span>
                  <Button variant="ghost" size="sm">
                    {(() => { const I = isExpanded ? UI_ICONS.expanded : UI_ICONS.collapsed; return <><span>{isExpanded ? 'Show less' : 'Show more'}</span><I className="ml-1 inline h-3.5 w-3.5 align-[-0.15em]" /></> })()}
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* End marker */}
      <div className="relative pl-16 md:pl-24 mt-8">
        <div className="absolute left-3 md:left-9 top-0 w-6 h-6 rounded-full bg-myth-surface-sunken border-4 border-myth-canvas flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-myth-surface-sunken" />
        </div>
        <div className="text-sm text-myth-ink-faint italic">
          The story continues...
        </div>
      </div>
    </div>
  )
}

// Compact version for sidebars
export function CompactTimeline({ events, onSelectEvent }: { events: TimelineEvent[]; onSelectEvent?: (event: TimelineEvent) => void }) {
  return (
    <div className="space-y-2">
      {events.slice(0, 5).map((event, index) => (
        <button
          key={event.id}
          onClick={() => onSelectEvent?.(event)}
          disabled={!onSelectEvent}
          className="flex w-full items-start gap-2 rounded-lg p-2 hover:bg-myth-surface-sunken transition-colors text-left disabled:cursor-default"
        >
          <div className="w-2 h-2 mt-2 rounded-full bg-myth-accent flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-myth-ink truncate">{event.title}</p>
            <p className="font-mono text-xs text-myth-ink-faint">Turn {event.turnNumber}</p>
          </div>
        </button>
      ))}
      {events.length > 5 && (
        <p className="text-xs text-myth-ink-faint text-center pt-2">
          +{events.length - 5} more events
        </p>
      )}
    </div>
  )
}
