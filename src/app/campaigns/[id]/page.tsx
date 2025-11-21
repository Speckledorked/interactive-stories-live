// src/app/campaigns/[id]/page.tsx
// Campaign lobby - shows campaign info, players, characters
// UPDATED WITH PHASE 8 COMMUNICATION FEATURES

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'
import CreateCharacterForm from "@/components/forms/CreateCharacterForm"
import ChatPanel from '@/components/chat/ChatPanel'
import NotesPanel from '@/components/notes/NotesPanel'
import NotificationPanel from '@/components/notifications/NotificationPanel'
import TurnTracker from '@/components/turns/TurnTracker'

interface CampaignData {
  campaign: any
  userRole: 'ADMIN' | 'PLAYER'
}

export default function CampaignLobbyPage() {
  const router = useRouter()
  const params = useParams()
  const campaignId = params.id as string

  const [data, setData] = useState<CampaignData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateCharacter, setShowCreateCharacter] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'chat' | 'notes'>('overview')
  const [showNotifications, setShowNotifications] = useState(false)
  const [deletingCharacterId, setDeletingCharacterId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    loadCampaign()
  }, [campaignId])

  const loadCampaign = async () => {
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}`)
      if (!response.ok) throw new Error('Failed to load campaign')

      const campaignData = await response.json()
      setData(campaignData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaign')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteCharacter = async (characterId: string) => {
    setDeleteError('')
    try {
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/characters/${characterId}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete character')
      }

      // Refresh campaign data
      await loadCampaign()
      setDeletingCharacterId(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete character')
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="card max-w-2xl mx-auto">
        <p className="text-red-400">{error || 'Campaign not found'}</p>
        <Link href="/campaigns" className="text-primary-400 hover:underline mt-4 inline-block">
          ← Back to campaigns
        </Link>
      </div>
    )
  }

  const { campaign, userRole } = data
  const userCharacters = campaign.characters.filter(
    (c: any) => c.userId === campaign.memberships.find((m: any) => m.role === userRole)?.userId
  )

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/campaigns"
          className="text-primary-400 hover:text-primary-300 text-sm mb-4 inline-block"
        >
          ← Back to campaigns
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">{campaign.title}</h1>
            <p className="text-gray-400">{campaign.description}</p>
            <div className="flex items-center space-x-4 mt-4 text-sm text-gray-500">
              <span>Universe: {campaign.universe}</span>
              <span>•</span>
              <span>Turn {campaign.worldMeta?.currentTurnNumber || 0}</span>
              <span>•</span>
              <span>{campaign.worldMeta?.currentInGameDate || 'Day 1'}</span>
            </div>
          </div>
          {userRole === 'ADMIN' && (
            <Link
              href={`/campaigns/${campaignId}/admin`}
              className="btn-secondary"
            >
              ⚙️ Settings
            </Link>
          )}
        </div>
      </div>

      {/* Navigation Tabs - Phase 8 Communication */}
      <div className="border-b border-gray-700 mb-6 sticky top-0 bg-gray-950/95 backdrop-blur z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            {[
              { key: 'overview', label: 'Overview' },
              { key: 'chat', label: 'Chat' },
              { key: 'notes', label: 'Notes' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.key
                    ? 'border-primary-500 text-primary-400'
                    : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Overview Tab - Existing Content */}
      {activeTab === 'overview' && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Enter Story Button */}
          <div className="card">
            <h2 className="card-header">Ready to Play?</h2>
            <p className="text-gray-400 mb-4">
              {userCharacters.length === 0
                ? 'Create a character first to enter the story'
                : 'Jump into the adventure!'}
            </p>
            <Link
              href={`/campaigns/${campaignId}/story`}
              className={`btn-primary inline-block ${
                userCharacters.length === 0 ? 'opacity-50 pointer-events-none' : ''
              }`}
            >
              🎭 Enter Story
            </Link>
          </div>

          {/* Your Characters */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="card-header mb-0">Your Characters</h2>
              <button
                type="button"
                onClick={() => setShowCreateCharacter(true)}
                className="text-primary-400 hover:text-primary-300 text-sm"
              >
                + Create Character
              </button>
            </div>

            {userCharacters.length === 0 ? (
              <p className="text-gray-500 text-sm">No characters yet. Create one to play!</p>
            ) : (
              <div className="space-y-3">
                {userCharacters.map((character: any) => (
                  <div key={character.id} className="bg-gray-900 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-bold text-white">{character.name}</h3>
                        <p className="text-sm text-gray-400">{character.concept}</p>
                        {character.currentLocation && (
                          <p className="text-xs text-gray-500 mt-1">
                            📍 {character.currentLocation}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded text-xs ${
                          character.isAlive
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-gray-700 text-gray-400'
                        }`}>
                          {character.isAlive ? 'Alive' : 'Dead'}
                        </span>
                        <button
                          onClick={() => setDeletingCharacterId(character.id)}
                          className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-500/10"
                          title="Delete character"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {Array.isArray(character.conditions) && character.conditions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {character.conditions.map((condition: string, i: number) => (
                          <span
                            key={i}
                            className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs"
                          >
                            {condition}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* All Characters in Campaign */}
          <div className="card">
            <h2 className="card-header">All Characters</h2>
            <div className="space-y-2">
              {campaign.characters.map((character: any) => (
                <div key={character.id} className="flex items-center justify-between py-2">
                  <div>
                    <span className="font-medium text-white">{character.name}</span>
                    <span className="text-gray-500 text-sm ml-2">
                      ({character.user.email})
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">{character.concept}</span>
                </div>
              ))}
              {campaign.characters.length === 0 && (
                <p className="text-gray-500 text-sm">No characters in this campaign yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Players */}
          <div className="card">
            <h2 className="card-header">Players</h2>
            <div className="space-y-2">
              {campaign.memberships.map((member: any) => (
                <div key={member.id} className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">{member.user.email}</span>
                  <span className={`px-2 py-1 rounded text-xs ${
                    member.role === 'ADMIN'
                      ? 'bg-primary-500/20 text-primary-400'
                      : 'bg-gray-700 text-gray-300'
                  }`}>
                    {member.role}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="card">
            <h2 className="card-header">Campaign Stats</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Scenes:</span>
                <span className="text-white font-medium">{campaign.scenes.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Characters:</span>
                <span className="text-white font-medium">{campaign.characters.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">NPCs:</span>
                <span className="text-white font-medium">{campaign.npcs.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Factions:</span>
                <span className="text-white font-medium">{campaign.factions.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Active Clocks:</span>
                <span className="text-white font-medium">{campaign.clocks.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Chat Tab - Phase 8 Communication */}
      {activeTab === 'chat' && data && (
        <div className="max-w-6xl mx-auto">
          <ChatPanel
            campaignId={campaignId}
            currentUserId={data.campaign.memberships[0]?.userId || ''}
            currentUserName={data.campaign.memberships[0]?.user?.email || 'Unknown'}
            userCharacters={data.campaign.characters}
            sceneId={''}
          />
        </div>
      )}

      {/* Notes Tab - Phase 8 Communication */}
      {activeTab === 'notes' && data && (
        <div className="max-w-6xl mx-auto">
          <NotesPanel
            campaignId={campaignId}
            currentUserId={data.campaign.memberships[0]?.userId || ''}
            characters={data.campaign.characters}
            npcs={data.campaign.npcs || []}
            factions={data.campaign.factions || []}
            scenes={data.campaign.scenes || []}
          />
        </div>
      )}

      {/* Notification Panel - Phase 8/9 Communication */}
      {data && (
        <NotificationPanel
          userId={data.campaign.memberships[0]?.userId || ''}
          campaignId={campaignId}
          isOpen={showNotifications}
          onClose={() => setShowNotifications(false)}
        />
      )}

      {/* Character Creation Modal */}
      {showCreateCharacter && (
        <div className="fixed inset-0 bg-gray-900/80 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-950 border border-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-2xl font-bold mb-4 text-white">Create New Character</h2>
            <CreateCharacterForm
              campaignId={campaignId}
              onSuccess={() => {
                setShowCreateCharacter(false)
                // Refresh characters list after creating a new one
                loadCampaign()
              }}
              onCancel={() => setShowCreateCharacter(false)}
            />
          </div>
        </div>
      )}

      {/* Delete Character Confirmation Modal */}
      {deletingCharacterId && (
        <div className="fixed inset-0 bg-gray-900/80 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-950 border border-gray-800 rounded-lg max-w-md w-full p-6">
            <h2 className="text-2xl font-bold mb-4 text-white">Delete Character?</h2>
            <p className="text-gray-400 mb-6">
              Are you sure you want to delete this character? This action cannot be undone.
              All associated actions and data will be permanently removed.
            </p>
            {deleteError && (
              <div className="bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-lg mb-4">
                {deleteError}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setDeletingCharacterId(null)
                  setDeleteError('')
                }}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteCharacter(deletingCharacterId)}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors flex-1"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
