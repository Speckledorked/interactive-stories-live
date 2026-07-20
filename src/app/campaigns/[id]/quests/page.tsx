'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Scroll } from 'lucide-react'
import { authenticatedFetch, isAuthenticated, setLastCampaignId } from '@/lib/clientAuth'
import { displayFont } from '@/lib/tavernTheme'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { TavernCard, TavernEmptyState, TavernSpinner } from '@/components/tavern/ui'

type QuestStatus = 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'ABANDONED'

interface Quest {
  id: string
  name: string
  description: string
  objective: string | null
  givenBy: string | null
  reward: string | null
  status: QuestStatus
  progressLog: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

interface Campaign {
  id: string
  name: string
}

const STATUS_GROUPS: { status: QuestStatus; label: string }[] = [
  { status: 'ACTIVE', label: 'Active' },
  { status: 'COMPLETED', label: 'Completed' },
  { status: 'FAILED', label: 'Failed' },
  { status: 'ABANDONED', label: 'Abandoned' },
]

const STATUS_BADGE: Record<QuestStatus, string> = {
  ACTIVE: 'text-ember-300 bg-ember-900/30 border-ember-800/40',
  COMPLETED: 'text-success-400 bg-success-900/20 border-success-800/40',
  FAILED: 'text-wine-400 bg-wine-800/20 border-wine-600/40',
  ABANDONED: 'text-ember-400/50 bg-black/30 border-ember-900/30',
}

// The last appended beat, not the full log - a quest log entry should read
// as "where this stands now," not a scroll of every past update.
function lastProgressBeat(progressLog: string | null): string | null {
  if (!progressLog) return null
  const lines = progressLog.split('\n').map(l => l.trim()).filter(Boolean)
  return lines.length > 0 ? lines[lines.length - 1] : null
}

export default function QuestsPage() {
  const params = useParams()
  const router = useRouter()
  const campaignId = params?.id as string

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [quests, setQuests] = useState<Quest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    if (campaignId) {
      loadQuests()
    }
  }, [campaignId])

  const loadQuests = async () => {
    try {
      const campaignResponse = await authenticatedFetch(`/api/campaigns/${campaignId}`)
      if (campaignResponse.ok) {
        const campaignData = await campaignResponse.json()
        setCampaign(campaignData.campaign)
        setLastCampaignId(campaignId)
      }

      const questsResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/quests`)
      if (questsResponse.ok) {
        const questsData = await questsResponse.json()
        setQuests(questsData.quests || [])
      } else {
        setError('Failed to load quests')
      }
    } catch (err) {
      setError('Failed to load quests')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <TavernPage>
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Quests" campaignId={campaignId} />
        <main className="max-w-4xl mx-auto px-4 pt-28 pb-16">
          <TavernSpinner className="h-16 w-16" />
        </main>
      </TavernPage>
    )
  }

  if (error) {
    return (
      <TavernPage>
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Quests" campaignId={campaignId} />
        <main className="max-w-4xl mx-auto px-4 pt-28 pb-16">
          <TavernCard className="p-6 bg-wine-800/20 border-wine-600/40">
            <p className="text-wine-400">{error}</p>
          </TavernCard>
        </main>
      </TavernPage>
    )
  }

  const activeCount = quests.filter(q => q.status === 'ACTIVE').length

  return (
    <TavernPage>
      <TavernHeader backHref={`/campaigns/${campaignId}`} title="Quests" campaignId={campaignId} />

      <main className="max-w-4xl mx-auto px-4 pt-28 pb-28">
        <p className="text-ember-300/50 text-sm mb-6">
          {campaign?.name || 'Campaign'} — {activeCount} active {activeCount === 1 ? 'quest' : 'quests'}
        </p>

        {quests.length === 0 ? (
          <TavernEmptyState
            icon={Scroll}
            title="No quests yet"
            description="Quests appear here once one's given to the party in a scene"
          />
        ) : (
          <div className="space-y-8">
            {STATUS_GROUPS.map(({ status, label }) => {
              const group = quests.filter(q => q.status === status)
              if (group.length === 0) return null

              return (
                <div key={status}>
                  <h2 className="text-xs font-medium text-ember-400/60 uppercase tracking-wide mb-3">
                    {label} ({group.length})
                  </h2>
                  <div className="space-y-4">
                    {group.map((quest) => {
                      const lastBeat = lastProgressBeat(quest.progressLog)
                      return (
                        <TavernCard key={quest.id} className="p-5">
                          <div className="flex items-start justify-between gap-4 mb-2">
                            <h3 className={`${displayFont.className} text-lg text-ember-100`}>{quest.name}</h3>
                            <span className={`text-xs font-medium border rounded px-2 py-1 whitespace-nowrap ${STATUS_BADGE[quest.status]}`}>
                              {quest.status.charAt(0) + quest.status.slice(1).toLowerCase()}
                            </span>
                          </div>

                          <p className="text-ember-200/70 leading-relaxed mb-3 whitespace-pre-wrap text-sm">
                            {quest.description}
                          </p>

                          {quest.objective && (
                            <p className="text-sm text-ember-300/60 mb-1">
                              <span className="text-ember-400/50">Objective: </span>{quest.objective}
                            </p>
                          )}
                          {quest.givenBy && (
                            <p className="text-sm text-ember-300/60 mb-1">
                              <span className="text-ember-400/50">Given by: </span>{quest.givenBy}
                            </p>
                          )}
                          {quest.reward && (
                            <p className="text-sm text-ember-300/60 mb-1">
                              <span className="text-ember-400/50">Reward: </span>{quest.reward}
                            </p>
                          )}

                          {lastBeat && (
                            <div className="mt-3 pt-3 border-t border-ember-900/30">
                              <p className="text-xs text-ember-400/50 mb-1">Latest</p>
                              <p className="text-sm text-ember-300/70">{lastBeat}</p>
                            </div>
                          )}
                        </TavernCard>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      <TavernNav active="quests" campaignId={campaignId} />
    </TavernPage>
  )
}
