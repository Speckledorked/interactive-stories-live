'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'
import CharacterSheetDisplay from '@/components/character/CharacterSheetDisplay'
import { DynamicDowntimeManager } from '@/components/downtime/DynamicDowntimeManager'
import { pusherClient } from '@/lib/pusher'

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
      const data = await response.json()
      setDowntimeActivities(prev => [data.activity, ...prev])
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-center items-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4"></div>
            <p className="text-gray-400">Loading character...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error || !character) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-400 mb-4">Error</h2>
          <p className="text-gray-400 mb-4">{error || 'Character not found'}</p>
          <Link
            href={`/campaigns/${campaignId}`}
            className="text-primary-400 hover:text-primary-300"
          >
            ← Back to Campaign
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Navigation */}
      <div className="mb-6">
        <Link
          href={`/campaigns/${campaignId}`}
          className="text-gray-400 hover:text-white transition-colors text-sm mb-3 inline-block"
        >
          ← Back to Campaign
        </Link>

        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-white">{character.name}</h1>
            <p className="text-gray-400 text-sm">{campaign?.campaign?.name}</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 border-b border-gray-700 pb-2 overflow-x-auto">
          <Link
            href={`/campaigns/${campaignId}`}
            className="px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-t transition-colors whitespace-nowrap"
          >
            Overview
          </Link>
          <Link
            href={`/campaigns/${campaignId}/story`}
            className="px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-t transition-colors whitespace-nowrap"
          >
            Story
          </Link>
          <span className="px-4 py-2 bg-primary-600 text-white rounded-t whitespace-nowrap">
            Character
          </span>
        </div>
      </div>

      {/* Character Sheet */}
      <div className="card">
        <CharacterSheetDisplay character={character} campaign={campaign?.campaign} />
      </div>

      {/* Downtime */}
      <div className="mt-8">
        <DynamicDowntimeManager
          activities={downtimeActivities}
          characterId={characterId}
          characterGold={(character?.resources as any)?.gold || 0}
          characterName={character?.name || ''}
          onCreateActivity={handleCreateDowntimeActivity}
          onAdvanceTime={handleAdvanceDowntimeTime}
          onRespondToEvent={handleRespondToDowntimeEvent}
          suggestions={downtimeSuggestions}
        />
      </div>
    </div>
  )
}
