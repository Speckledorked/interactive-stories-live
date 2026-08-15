'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { authenticatedFetch, isAuthenticated, setLastCampaignId } from '@/lib/clientAuth'
import { fontDisplay } from '@/lib/fonts'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { EmptyState } from '@/components/ui/empty-state'
import { HEADER_OFFSET } from '@/components/tavern/headerOffset'

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
  ACTIVE: 'text-myth-info bg-myth-info/10 border-myth-info/30',
  COMPLETED: 'text-myth-good bg-myth-good/10 border-myth-good/30',
  FAILED: 'text-myth-danger bg-myth-danger/10 border-myth-danger/30',
  ABANDONED: 'text-myth-ink-faint bg-myth-surface-sunken border-myth-border',
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
      <TavernPage background="myth">
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Quests" campaignId={campaignId} variant="myth" />
        <main className={`max-w-4xl mx-auto px-4 ${HEADER_OFFSET} pb-16`}>
          <div className="flex justify-center py-16">
            <div className="h-16 w-16 animate-spin rounded-full border-b-2 border-myth-accent" />
          </div>
        </main>
      </TavernPage>
    )
  }

  if (error) {
    return (
      <TavernPage background="myth">
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Quests" campaignId={campaignId} variant="myth" />
        <main className={`max-w-4xl mx-auto px-4 ${HEADER_OFFSET} pb-16`}>
          <div className="rounded-lg border border-myth-danger/30 bg-myth-danger/10 p-6">
            <p className="text-myth-danger">{error}</p>
          </div>
        </main>
      </TavernPage>
    )
  }

  const activeCount = quests.filter(q => q.status === 'ACTIVE').length

  return (
    <TavernPage background="myth">
      <TavernHeader backHref={`/campaigns/${campaignId}`} title="Quests" campaignId={campaignId} variant="myth" />

      <main className={`max-w-4xl mx-auto px-4 ${HEADER_OFFSET} pb-28`}>
        <p className="mb-6 text-sm text-myth-ink-faint">
          {campaign?.name || 'Campaign'} — {activeCount} active {activeCount === 1 ? 'quest' : 'quests'}
        </p>

        {quests.length === 0 ? (
          <EmptyState
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
                  <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-myth-ink-faint">
                    {label} ({group.length})
                  </h2>
                  {/* Quest descriptions are narrative content meant to be
                      read — flowing/divided, not individually boxed (see
                      docs/design-system.md). */}
                  <div className="divide-y divide-myth-border">
                    {group.map((quest) => {
                      const lastBeat = lastProgressBeat(quest.progressLog)
                      return (
                        <div key={quest.id} className="py-5 first:pt-0">
                          <div className="mb-2 flex items-start justify-between gap-4">
                            <h3 className={`${fontDisplay.className} text-lg font-semibold text-myth-ink`}>{quest.name}</h3>
                            <span className={`text-xs font-medium border rounded px-2 py-1 whitespace-nowrap ${STATUS_BADGE[quest.status]}`}>
                              {quest.status.charAt(0) + quest.status.slice(1).toLowerCase()}
                            </span>
                          </div>

                          <p className="mb-3 whitespace-pre-wrap text-sm leading-relaxed text-myth-ink-muted">
                            {quest.description}
                          </p>

                          {quest.objective && (
                            <p className="mb-1 text-sm text-myth-ink-muted">
                              <span className="text-myth-ink-faint">Objective: </span>{quest.objective}
                            </p>
                          )}
                          {quest.givenBy && (
                            <p className="mb-1 text-sm text-myth-ink-muted">
                              <span className="text-myth-ink-faint">Given by: </span>{quest.givenBy}
                            </p>
                          )}
                          {quest.reward && (
                            <p className="mb-1 text-sm text-myth-ink-muted">
                              <span className="text-myth-ink-faint">Reward: </span>{quest.reward}
                            </p>
                          )}

                          {lastBeat && (
                            <div className="mt-3 border-t border-myth-border pt-3">
                              <p className="mb-1 text-xs text-myth-ink-faint">Latest</p>
                              <p className="text-sm text-myth-ink-muted">{lastBeat}</p>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      <TavernNav campaignId={campaignId} variant="myth" />
    </TavernPage>
  )
}
