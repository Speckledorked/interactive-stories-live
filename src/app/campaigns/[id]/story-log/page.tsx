'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, BookOpen } from 'lucide-react'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'
import { displayFont } from '@/lib/tavernTheme'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { TavernCard, TavernEmptyState, TavernSpinner } from '@/components/tavern/ui'

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
      const campaignResponse = await authenticatedFetch(`/api/campaigns/${campaignId}`)
      if (campaignResponse.ok) {
        const campaignData = await campaignResponse.json()
        setCampaign(campaignData.campaign)
      }

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
      <TavernPage>
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Story Log" />
        <main className="max-w-4xl mx-auto px-4 pt-28 pb-16">
          <TavernSpinner className="h-16 w-16" />
        </main>
      </TavernPage>
    )
  }

  if (error) {
    return (
      <TavernPage>
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Story Log" />
        <main className="max-w-4xl mx-auto px-4 pt-28 pb-16">
          <TavernCard className="p-6 bg-wine-800/20 border-wine-600/40">
            <p className="text-wine-400">{error}</p>
          </TavernCard>
        </main>
      </TavernPage>
    )
  }

  return (
    <TavernPage>
      <TavernHeader backHref={`/campaigns/${campaignId}`} title="Story Log" />

      <main className="max-w-4xl mx-auto px-4 pt-28 pb-28">
        <p className="text-ember-300/50 text-sm mb-6">
          {campaign?.name || 'Campaign'} — a chronicle of your adventure, updated after each scene
        </p>

        {/* Stats */}
        <TavernCard className="p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className={`${displayFont.className} text-3xl text-ember-300 mb-1`}>{logs.length}</div>
              <div className="text-sm text-ember-400/50">Chronicle Entries</div>
            </div>
            <div className="text-center">
              <div className={`${displayFont.className} text-3xl text-success-400 mb-1`}>
                {logs.reduce((sum, l) => sum + (l.highlights?.length || 0), 0)}
              </div>
              <div className="text-sm text-ember-400/50">Key Moments</div>
            </div>
            <div className="text-center">
              <div className={`${displayFont.className} text-3xl text-ember-300 mb-1`}>{logs[0]?.turnNumber || 0}</div>
              <div className="text-sm text-ember-400/50">Current Turn</div>
            </div>
          </div>
        </TavernCard>

        {/* Log Entries */}
        <div className="space-y-4">
          {logs.length === 0 ? (
            <TavernEmptyState
              icon={BookOpen}
              title="No story entries yet"
              description="The story log will be automatically updated as scenes are resolved"
            />
          ) : (
            logs.map((log) => (
              <Link key={log.id} href={`/campaigns/${campaignId}/story`} className="block">
                <TavernCard className="p-5 group hover:border-ember-700/50 transition-colors cursor-pointer">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs font-medium text-ember-300 bg-ember-900/30 border border-ember-800/40 rounded px-2 py-1">
                        Turn {log.turnNumber}
                      </span>
                      {log.entryType !== 'scene' && (
                        <span className="text-xs px-2 py-1 rounded bg-black/30 border border-ember-900/30 text-ember-400/60">
                          {log.entryType}
                        </span>
                      )}
                      <h3 className={`${displayFont.className} text-lg text-ember-100`}>{log.title}</h3>
                    </div>
                    <div className="text-xs text-ember-400/40 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </div>
                  </div>

                  {log.inGameDate && (
                    <p className="text-xs text-ember-400/50 mb-3">
                      {log.inGameDate}
                      {log.duration && ` • Duration: ${log.duration}`}
                    </p>
                  )}

                  <p className="text-ember-200/70 leading-relaxed mb-4 whitespace-pre-wrap text-sm">{log.summary}</p>

                  {log.highlights && log.highlights.length > 0 && (
                    <div className="pt-4 border-t border-ember-900/30">
                      <h4 className="text-xs font-medium text-ember-400/60 mb-2">Key Moments</h4>
                      <ul className="space-y-1">
                        {log.highlights.map((highlight, i) => (
                          <li key={i} className="text-sm text-ember-300/60 flex items-start gap-2">
                            <span className="text-ember-500 mt-1">•</span>
                            <span>{highlight}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-4 flex items-center gap-1 text-sm text-ember-300 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span>View in Story</span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </TavernCard>
              </Link>
            ))
          )}
        </div>
      </main>

      <TavernNav active="quests" campaignId={campaignId} />
    </TavernPage>
  )
}
