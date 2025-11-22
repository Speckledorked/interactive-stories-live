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
        <p className="text-xl text-gray-300 mb-2">Your story begins here</p>
        <p className="text-sm text-gray-500">Events will appear as your adventure unfolds</p>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-6 md:left-12 top-0 bottom-0 w-1 bg-gradient-to-b from-primary-500 via-primary-600 to-transparent" />

      {/* Events */}
      <div className="space-y-8">
        {events.map((event, index) => {
          const isExpanded = expandedId === event.id
          const sceneText = event.sceneIntroText || event.sceneResolutionText || event.summary
          const moods = detectSceneMood(sceneText)

          return (
            <div key={event.id} className="relative pl-16 md:pl-24">
              {/* Timeline dot */}
              <div className="absolute left-3 md:left-9 top-0 w-6 h-6 rounded-full bg-primary-500 border-4 border-gray-900 shadow-lg shadow-primary-500/50 flex items-center justify-center">
                {index === 0 && <div className="w-2 h-2 rounded-full bg-white animate-pulse" />}
              </div>

              {/* Event card */}
              <div
                className={`
                  card bg-gradient-to-br from-gray-800 to-gray-900 border-gray-700
                  hover:border-primary-500/50 transition-all duration-300
                  cursor-pointer
                  ${isExpanded ? 'ring-2 ring-primary-500/50' : ''}
                `}
                onClick={() => setExpandedId(isExpanded ? null : event.id)}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      {event.sceneNumber && (
                        <div className="bg-primary-500/20 border border-primary-500/50 rounded-full px-3 py-1 text-xs font-bold text-primary-300">
                          Scene {event.sceneNumber}
                        </div>
                      )}
                      <div className="text-xs text-gray-500">
                        Turn {event.turnNumber}
                      </div>
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2">{event.title}</h3>

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
                        ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                        : event.status === 'AWAITING_ACTIONS'
                          ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50'
                          : 'bg-gray-500/20 text-gray-400 border border-gray-500/50'
                      }
                    `}>
                      {event.status.replace('_', ' ')}
                    </div>
                  )}
                </div>

                {/* Summary */}
                <p className={`text-gray-300 text-sm ${compact && !isExpanded ? 'line-clamp-2' : ''}`}>
                  {event.summary}
                </p>

                {/* Expanded content */}
                {isExpanded && event.sceneIntroText && (
                  <div className="mt-4 pt-4 border-t border-gray-700">
                    <p className="text-sm text-gray-400 mb-2 font-semibold">Scene Introduction:</p>
                    <p className="text-gray-300 text-sm whitespace-pre-wrap bg-gray-800/50 p-3 rounded border border-gray-700">
                      {event.sceneIntroText}
                    </p>
                  </div>
                )}

                {/* Metadata */}
                <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                  <span>{new Date(event.createdAt).toLocaleDateString()} at {new Date(event.createdAt).toLocaleTimeString()}</span>
                  <button className="text-primary-400 hover:text-primary-300">
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
        <div className="absolute left-3 md:left-9 top-0 w-6 h-6 rounded-full bg-gray-700 border-4 border-gray-900 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-gray-600" />
        </div>
        <div className="text-sm text-gray-500 italic">
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
        <div key={event.id} className="flex items-start gap-2 p-2 rounded hover:bg-gray-800 transition-colors">
          <div className="w-2 h-2 mt-2 rounded-full bg-primary-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{event.title}</p>
            <p className="text-xs text-gray-500">Turn {event.turnNumber}</p>
          </div>
        </div>
      ))}
      {events.length > 5 && (
        <p className="text-xs text-gray-500 text-center pt-2">
          +{events.length - 5} more events
        </p>
      )}
    </div>
  )
}
