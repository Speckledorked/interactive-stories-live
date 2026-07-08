'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'

interface CampaignLogEntry {
  id: string
  sceneId: string | null
  turnNumber: number
  title: string
  summary: string
  highlights: string[]
  entryType: string
  inGameDate: string | null
  duration: string | null
  createdAt: string
}

interface Campaign {
  id: string
  name: string
  description: string | null
}

export default function StoryLogPage() {
  const params = useParams()
  const router = useRouter()
  const campaignId = params?.id as string

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [logs, setLogs] = useState<CampaignLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    if (campaignId) {
      loadStoryLog()
    }
  }, [campaignId])

  const loadStoryLog = async () => {
    try {
      // Load campaign info
      const campaignResponse = await authenticatedFetch(`/api/campaigns/${campaignId}`)
      if (campaignResponse.ok) {
        const campaignData = await campaignResponse.json()
        setCampaign(campaignData.campaign)
      }

      // Load the actual story log — a chronicle entry gets written per scene
      // resolution (see generateCampaignLog in sceneResolver.ts), each with
      // its own title/summary/highlights. This used to fetch raw scenes and
      // truncate their resolution text instead, which is why this page
      // never showed a real recap.
      const logsResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/logs`)
      if (logsResponse.ok) {
        const logsData = await logsResponse.json()
        setLogs((logsData.logs || []).slice().reverse()) // newest first
      } else {
        setError('Failed to load story log')
      }
    } catch (err) {
      setError('Failed to load story log')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <div className="relative">
          <div className="spinner h-16 w-16"></div>
          <div className="absolute inset-0 h-16 w-16 rounded-full bg-primary-500/20 animate-ping"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="card bg-gradient-to-br from-danger-900/20 to-danger-800/10 border-danger-700/30">
          <p className="text-danger-400">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto animate-fade-in">
      <div className="mb-12">
        <Link
          href={`/campaigns/${campaignId}`}
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition-colors group"
        >
          <svg className="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Campaign
        </Link>

        <div className="relative">
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-primary-500/10 via-accent-500/5 to-transparent blur-3xl"></div>
          <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent mb-3">
            Story Log
          </h1>
          <p className="text-lg text-gray-400">
            {campaign?.name || 'Campaign'} - A chronicle of your adventure, updated after each scene
          </p>
        </div>
      </div>

      {/* Stats Card */}
      <div className="card mb-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-primary-500/10 to-transparent blur-3xl"></div>
        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center">
            <div className="text-4xl font-bold bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent mb-2">
              {logs.length}
            </div>
            <div className="text-sm text-gray-400">Chronicle Entries</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold bg-gradient-to-r from-success-400 to-success-600 bg-clip-text text-transparent mb-2">
              {logs.reduce((sum, l) => sum + (l.highlights?.length || 0), 0)}
            </div>
            <div className="text-sm text-gray-400">Key Moments</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold bg-gradient-to-r from-warning-400 to-warning-600 bg-clip-text text-transparent mb-2">
              {logs[0]?.turnNumber || 0}
            </div>
            <div className="text-sm text-gray-400">Current Turn</div>
          </div>
        </div>
      </div>

      {/* Log Entries */}
      <div className="space-y-4">
        {logs.length === 0 ? (
          <div className="card text-center py-12">
            <div className="text-6xl mb-4">📖</div>
            <p className="text-xl text-gray-400 mb-2">No story entries yet</p>
            <p className="text-sm text-gray-500">The story log will be automatically updated as scenes are resolved</p>
          </div>
        ) : (
          logs.map((log, index) => (
            <Link
              key={log.id}
              href={`/campaigns/${campaignId}/story`}
              className="block"
            >
              <div
                className="card group hover:border-primary-700/50 hover:shadow-glow transition-all duration-200 cursor-pointer"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-primary-400 bg-primary-900/30 border border-primary-700/50 rounded px-2 py-1">
                      Turn {log.turnNumber}
                    </span>
                    {log.entryType !== 'scene' && (
                      <span className="badge bg-gray-700/30 border-gray-600/50 text-gray-400">
                        {log.entryType}
                      </span>
                    )}
                    <h3 className="text-xl font-bold text-white">{log.title}</h3>
                  </div>
                  <div className="text-xs text-gray-500 whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>

                {log.inGameDate && (
                  <p className="text-xs text-gray-500 mb-3">
                    📅 {log.inGameDate}
                    {log.duration && ` • Duration: ${log.duration}`}
                  </p>
                )}

                {/* Summary — the actual recap, not truncated raw scene text */}
                <p className="text-gray-300 leading-relaxed mb-4 whitespace-pre-wrap">
                  {log.summary}
                </p>

                {/* Highlights */}
                {log.highlights && log.highlights.length > 0 && (
                  <div className="pt-4 border-t border-dark-700/50">
                    <h4 className="text-xs font-medium text-gray-400 mb-2">Key Moments</h4>
                    <ul className="space-y-1">
                      {log.highlights.map((highlight, i) => (
                        <li key={i} className="text-sm text-gray-400 flex items-start gap-2">
                          <span className="text-primary-500 mt-1">•</span>
                          <span>{highlight}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* View link indicator */}
                <div className="mt-4 flex items-center gap-2 text-sm text-primary-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span>View in Story</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
