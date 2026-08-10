'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { authenticatedFetch, isAuthenticated, setLastCampaignId } from '@/lib/clientAuth'
import CharacterSheetDisplay from '@/components/character/CharacterSheetDisplay'
import { pusherClient } from '@/lib/pusher'
import { Home, Scroll, User } from 'lucide-react'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { SubNavTabs } from '@/components/ui/SubNavTabs'

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
  // #172: two `scene:resolved` events firing in quick succession (two
  // exchanges resolving back-to-back) used to race — loadData() had no way
  // to tell an in-flight call it had been superseded, so whichever fetch
  // happened to settle last won, not necessarily the one triggered by the
  // more recent event. Every setState below is gated on still being the
  // most recently started load.
  const loadRequestIdRef = useRef(0)

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
    const requestId = ++loadRequestIdRef.current
    const isStale = () => requestId !== loadRequestIdRef.current

    try {
      setLoading(true)

      // Load campaign info
      const campaignResponse = await authenticatedFetch(
        `/api/campaigns/${campaignId}`
      )
      if (isStale()) return
      if (campaignResponse.ok) {
        const campaignData = await campaignResponse.json()
        if (isStale()) return
        setCampaign(campaignData)
        setLastCampaignId(campaignId)
      }

      // Load character info
      const characterResponse = await authenticatedFetch(
        `/api/campaigns/${campaignId}/characters/${characterId}`
      )
      if (isStale()) return
      if (characterResponse.ok) {
        const characterData = await characterResponse.json()
        if (isStale()) return
        setCharacter(characterData)
      } else {
        setError('Character not found')
      }

      // Load downtime activities and suggestions
      const [activitiesRes, suggestionsRes] = await Promise.all([
        authenticatedFetch(`/api/characters/${characterId}/dynamic-downtime`),
        authenticatedFetch(`/api/characters/${characterId}/dynamic-downtime/suggestions`).catch(() => null)
      ])
      if (isStale()) return
      if (activitiesRes.ok) {
        setDowntimeActivities(await activitiesRes.json())
      }
      if (suggestionsRes?.ok) {
        const data = await suggestionsRes.json()
        if (isStale()) return
        setDowntimeSuggestions(data.suggestions || [])
      }
    } catch (err) {
      if (!isStale()) setError('Failed to load character')
    } finally {
      if (!isStale()) setLoading(false)
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
      <TavernPage background="myth">
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Loading…" campaignId={campaignId} variant="myth" />
        <main className="max-w-6xl mx-auto px-4 pt-28 pb-16">
          <div className="flex justify-center py-16">
            <div className="h-16 w-16 animate-spin rounded-full border-b-2 border-myth-accent" />
          </div>
        </main>
      </TavernPage>
    )
  }

  if (error || !character) {
    return (
      <TavernPage background="myth">
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Character" campaignId={campaignId} variant="myth" />
        <main className="max-w-6xl mx-auto px-4 pt-28 pb-16 text-center">
          <h2 className="mb-4 text-2xl font-bold text-myth-danger">Error</h2>
          <p className="mb-4 text-myth-ink-muted">{error || 'Character not found'}</p>
          <Link href={`/campaigns/${campaignId}`} className="text-myth-accent hover:text-myth-accent-hover">
            ← Back to Campaign
          </Link>
        </main>
      </TavernPage>
    )
  }

  return (
    <TavernPage background="myth">
      <TavernHeader
        backHref={`/campaigns/${campaignId}`}
        title={character.name}
        campaignId={campaignId}
        isAdmin={campaign?.userRole === 'ADMIN'}
        variant="myth"
        subrow={
          <nav className="max-w-6xl mx-auto px-4 flex items-center gap-1 text-sm border-t border-myth-border pt-2 pb-0">
            <SubNavTabs
              tabs={[
                { key: 'overview', label: 'Overview', icon: Home, href: `/campaigns/${campaignId}` },
                { key: 'story', label: 'Story', icon: Scroll, href: `/campaigns/${campaignId}/story` },
                { key: 'character', label: 'Character', icon: User },
              ]}
              activeKey="character"
              variant="myth"
            />
          </nav>
        }
      />

      <main className="max-w-6xl mx-auto px-4 pt-28 pb-28">
        <p className="mb-4 text-sm text-myth-ink-faint">{campaign?.campaign?.name}</p>

        {/* Character Sheet (Downtime is one of its tabs) */}
        <CharacterSheetDisplay
          character={character}
          campaign={campaign?.campaign}
          downtimeActivities={downtimeActivities}
          downtimeSuggestions={downtimeSuggestions}
          onCreateDowntimeActivity={handleCreateDowntimeActivity}
          onAdvanceDowntimeTime={handleAdvanceDowntimeTime}
          onRespondToDowntimeEvent={handleRespondToDowntimeEvent}
        />
      </main>

      <TavernNav active="characters" campaignId={campaignId} variant="myth" />
    </TavernPage>
  )
}
