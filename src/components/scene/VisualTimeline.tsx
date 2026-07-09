// src/components/scene/VisualTimeline.tsx
// Enhanced visual timeline with better design

'use client'

import { useState } from 'react'
import SceneMoodTag, { detectSceneMood } from './SceneMoodTag'

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
        <div className="text-6xl mb-4">📖</div>
        <p className="text-xl text-ember-200/70 mb-2">Your story begins here</p>
        <p className="text-sm text-ember-400/50">Events will appear as your adventure unfolds</p>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-6 md:left-12 top-0 bottom-0 w-1 bg-gradient-to-b from-ember-500 via-ember-600 to-transparent" />

      {/* Events */}
      <div className="space-y-8">
        {events.map((event, index) => {
          const isExpanded = expandedId === event.id
          const sceneText = event.sceneIntroText || event.sceneResolutionText || event.summary
          const moods = detectSceneMood(sceneText)

          return (
            <div key={event.id} className="relative pl-16 md:pl-24">
              {/* Timeline dot */}
              <div className="absolute left-3 md:left-9 top-0 w-6 h-6 rounded-full bg-ember-500 border-4 border-tavern-950 shadow-lg shadow-ember-500/50 flex items-center justify-center">
                {index === 0 && <div className="w-2 h-2 rounded-full bg-tavern-950 animate-pulse" />}
              </div>

              {/* Event card */}
              <div
                className={`
                  rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5
                  hover:border-ember-700/50 transition-all duration-300
                  cursor-pointer
                  ${isExpanded ? 'ring-2 ring-ember-500/40' : ''}
                `}
                onClick={() => setExpandedId(isExpanded ? null : event.id)}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      {event.sceneNumber && (
                        <div className="bg-ember-900/30 border border-ember-800/40 rounded-full px-3 py-1 text-xs font-bold text-ember-300">
                          Scene {event.sceneNumber}
                        </div>
                      )}
                      <div className="text-xs text-ember-400/50">
                        Turn {event.turnNumber}
                      </div>
                    </div>
                    <h3 className="text-lg font-bold text-ember-100 mb-2">{event.title}</h3>

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
                          ? 'bg-ember-900/30 text-ember-300 border border-ember-700/40'
                          : 'bg-black/25 text-ember-400/50 border border-ember-900/30'
                      }
                    `}>
                      {event.status.replace('_', ' ')}
                    </div>
                  )}
                </div>

                {/* Summary */}
                <p className={`text-ember-200/70 text-sm ${compact && !isExpanded ? 'line-clamp-2' : ''}`}>
                  {event.summary}
                </p>

                {/* Expanded content */}
                {isExpanded && event.sceneIntroText && (
                  <div className="mt-4 pt-4 border-t border-ember-900/30">
                    <p className="text-sm text-ember-400/60 mb-2 font-semibold">Scene Introduction:</p>
                    <p className="text-ember-200/70 text-sm whitespace-pre-wrap bg-black/25 p-3 rounded border border-ember-900/30">
                      {event.sceneIntroText}
                    </p>
                  </div>
                )}

                {/* Metadata */}
                <div className="mt-4 flex items-center justify-between text-xs text-ember-400/40">
                  <span>{new Date(event.createdAt).toLocaleDateString()} at {new Date(event.createdAt).toLocaleTimeString()}</span>
                  <button className="text-ember-300 hover:text-ember-200">
                    {isExpanded ? 'Show less ▲' : 'Show more ▼'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* End marker */}
      <div className="relative pl-16 md:pl-24 mt-8">
        <div className="absolute left-3 md:left-9 top-0 w-6 h-6 rounded-full bg-black/30 border-4 border-tavern-950 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-ember-900/60" />
        </div>
        <div className="text-sm text-ember-400/40 italic">
          The story continues...
        </div>
      </div>
    </div>
  )
}

// Compact version for sidebars
export function CompactTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="space-y-2">
      {events.slice(0, 5).map((event, index) => (
        <div key={event.id} className="flex items-start gap-2 p-2 rounded hover:bg-black/25 transition-colors">
          <div className="w-2 h-2 mt-2 rounded-full bg-ember-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-ember-100 truncate">{event.title}</p>
            <p className="text-xs text-ember-400/50">Turn {event.turnNumber}</p>
          </div>
        </div>
      ))}
      {events.length > 5 && (
        <p className="text-xs text-ember-400/40 text-center pt-2">
          +{events.length - 5} more events
        </p>
      )}
    </div>
  )
}
