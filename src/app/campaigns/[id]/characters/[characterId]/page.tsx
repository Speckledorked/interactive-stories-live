'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { authenticatedFetch, isAuthenticated, setLastCampaignId } from '@/lib/clientAuth'
import CharacterSheetDisplay from '@/components/character/CharacterSheetDisplay'
import { pusherClient } from '@/lib/pusher'
import { Home, Scroll, User } from 'lucide-react'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { TavernCard, TavernSpinner } from '@/components/tavern/ui'

export default function CharacterPage() {
  const router = useRouter()
  const params = useParams()
  const campaignId = params.id as string
  const characterId = params.characterId as string

  const [character, setCharacter] = useState<any>(null)
  const [campaign, setCampaign] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downtimeActivities, setDowntimeActivities] = useState<any[]>([])
  const [downtimeSuggestions, setDowntimeSuggestions] = useState<string[]>([])

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    loadData()
  }, [campaignId, characterId])

  // Live-update character sheet when a scene resolves
  useEffect(() => {
    if (!pusherClient) return

    const channel = pusherClient.subscribe(`campaign-${campaignId}`)

    channel.bind('scene:resolved', () => {
      loadData()
    })

    return () => {
      if (pusherClient) {
        pusherClient.unsubscribe(`campaign-${campaignId}`)
      }
    }
  }, [campaignId])

  const loadData = async () => {
    try {
      setLoading(true)

      // Load campaign info
      const campaignResponse = await authenticatedFetch(
        `/api/campaigns/${campaignId}`
      )
      if (campaignResponse.ok) {
        const campaignData = await campaignResponse.json()
        setCampaign(campaignData)
        setLastCampaignId(campaignId)
      }

      // Load character info
      const characterResponse = await authenticatedFetch(
        `/api/campaigns/${campaignId}/characters/${characterId}`
      )
      if (characterResponse.ok) {
        const characterData = await characterResponse.json()
        setCharacter(characterData)
      } else {
        setError('Character not found')
      }

      // Load downtime activities and suggestions
      const [activitiesRes, suggestionsRes] = await Promise.all([
        authenticatedFetch(`/api/characters/${characterId}/dynamic-downtime`),
        authenticatedFetch(`/api/characters/${characterId}/dynamic-downtime/suggestions`).catch(() => null)
      ])
      if (activitiesRes.ok) {
        setDowntimeActivities(await activitiesRes.json())
      }
      if (suggestionsRes?.ok) {
        const data = await suggestionsRes.json()
        setDowntimeSuggestions(data.suggestions || [])
      }
    } catch (err) {
      setError('Failed to load character')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateDowntimeActivity = async (description: string) => {
    const response = await authenticatedFetch(`/api/characters/${characterId}/dynamic-downtime`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description })
    })
    if (response.ok) {
      // Re-fetch rather than trust the POST response shape: it returns the
      // raw activity record, not the transformed shape (with `events`,
      // lowercase `status`, etc.) that DynamicDowntimeManager expects.
      const activitiesRes = await authenticatedFetch(`/api/characters/${characterId}/dynamic-downtime`)
      if (activitiesRes.ok) setDowntimeActivities(await activitiesRes.json())
    }
  }

  const handleAdvanceDowntimeTime = async (charId: string, days: number) => {
    const response = await authenticatedFetch(`/api/characters/${charId}/dynamic-downtime`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days })
    })
    if (response.ok) {
      // Reload activities to reflect new state
      const activitiesRes = await authenticatedFetch(`/api/characters/${charId}/dynamic-downtime`)
      if (activitiesRes.ok) setDowntimeActivities(await activitiesRes.json())
    }
  }

  const handleRespondToDowntimeEvent = async (eventId: string, responseText: string) => {
    await authenticatedFetch(`/api/dynamic-downtime-events/${eventId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: responseText })
    })
    // Reload activities to reflect response
    const activitiesRes = await authenticatedFetch(`/api/characters/${characterId}/dynamic-downtime`)
    if (activitiesRes.ok) setDowntimeActivities(await activitiesRes.json())
  }

  if (loading) {
    return (
      <TavernPage>
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Loading…" campaignId={campaignId} />
        <main className="max-w-6xl mx-auto px-4 pt-28 pb-16">
          <TavernSpinner className="h-16 w-16" />
        </main>
      </TavernPage>
    )
  }

  if (error || !character) {
    return (
      <TavernPage>
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Character" campaignId={campaignId} />
        <main className="max-w-6xl mx-auto px-4 pt-28 pb-16 text-center">
          <h2 className="text-2xl font-bold text-wine-400 mb-4">Error</h2>
          <p className="text-ember-300/60 mb-4">{error || 'Character not found'}</p>
          <Link href={`/campaigns/${campaignId}`} className="text-ember-300 hover:text-ember-200">
            ← Back to Campaign
          </Link>
        </main>
      </TavernPage>
    )
  }

  return (
    <TavernPage>
      <TavernHeader
        backHref={`/campaigns/${campaignId}`}
        title={character.name}
        campaignId={campaignId}
        isAdmin={campaign?.userRole === 'ADMIN'}
        subrow={
          <nav className="max-w-6xl mx-auto px-4 flex items-center gap-1 text-sm border-t border-ember-900/20 pt-2 pb-0">
            <Link
              href={`/campaigns/${campaignId}`}
              className="flex items-center gap-1.5 px-2.5 py-2 border-b-2 border-transparent text-ember-300/40 hover:text-ember-300/70 transition-colors"
            >
              <Home className="w-3.5 h-3.5" />
              Overview
            </Link>
            <Link
              href={`/campaigns/${campaignId}/story`}
              className="flex items-center gap-1.5 px-2.5 py-2 border-b-2 border-transparent text-ember-300/40 hover:text-ember-300/70 transition-colors"
            >
              <Scroll className="w-3.5 h-3.5" />
              Story
            </Link>
            <span className="flex items-center gap-1.5 px-2.5 py-2 border-b-2 border-ember-400 text-ember-200">
              <User className="w-3.5 h-3.5" />
              Character
            </span>
          </nav>
        }
      />

      <main className="max-w-6xl mx-auto px-4 pt-28 pb-28">
        <p className="text-ember-300/50 text-sm mb-4">{campaign?.campaign?.name}</p>

        {/* Character Sheet (Downtime is one of its tabs) */}
        <TavernCard className="p-5">
          <CharacterSheetDisplay
            character={character}
            campaign={campaign?.campaign}
            downtimeActivities={downtimeActivities}
            downtimeSuggestions={downtimeSuggestions}
            onCreateDowntimeActivity={handleCreateDowntimeActivity}
            onAdvanceDowntimeTime={handleAdvanceDowntimeTime}
            onRespondToDowntimeEvent={handleRespondToDowntimeEvent}
          />
        </TavernCard>
      </main>

      <TavernNav active="characters" campaignId={campaignId} />
    </TavernPage>
  )
}
