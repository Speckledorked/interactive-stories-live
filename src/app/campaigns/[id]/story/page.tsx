// src/app/campaigns/[id]/story/page.tsx
// Main story view - where the game happens!

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { authenticatedFetch, isAuthenticated, getUser } from '@/lib/clientAuth'
import { pusherClient } from '@/lib/pusher'

export default function StoryPage() {
  const router = useRouter()
  const params = useParams()
  const campaignId = params.id as string

  const [campaign, setCampaign] = useState<any>(null)
  const [currentScene, setCurrentScene] = useState<any>(null)
  const [userCharacters, setUserCharacters] = useState<any[]>([])
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('')
  const [actionText, setActionText] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const user = getUser()
  const isAdmin = campaign?.userRole === 'ADMIN'

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    loadData()
  }, [campaignId])

  const loadData = async () => {
    try {
      // Load campaign data
      const campResponse = await authenticatedFetch(`/api/campaigns/${campaignId}`)
      if (!campResponse.ok) throw new Error('Failed to load campaign')
      const campData = await campResponse.json()
      setCampaign(campData)

      // Load current scene
      const sceneResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/scene`)
      if (!sceneResponse.ok) throw new Error('Failed to load scene')
      const sceneData = await sceneResponse.json()
      setCurrentScene(sceneData.scene)

      // Get user's characters
      const userChars = campData.campaign?.characters?.filter(
        (c: any) => c.userId === user?.id
      ) || []
      setUserCharacters(userChars)
      if (userChars.length > 0 && !selectedCharacterId) {
        setSelectedCharacterId(userChars[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  // Pusher realtime subscriptions
  useEffect(() => {
    // Subscribe to the campaign channel
    const channel = pusherClient.subscribe(`campaign-${campaignId}`)

    // Listen for new actions
    channel.bind('action:created', (data: any) => {
      console.log('New action created:', data)
      // Refresh data so actions list stays up to date
      loadData()
    })

    // Listen for scene resolutions
    channel.bind('scene:resolved', (data: any) => {
      console.log('Scene resolved:', data)
      // Refresh data so scene resolution appears
      loadData()
    })

    // Listen for clock updates
    channel.bind('clock:updated', (data: any) => {
      console.log('Clock updated:', data)
      // Reload to get latest clock state
      loadData()
    })

    channel.bind('clock:ticked', (data: any) => {
      console.log('Clock ticked:', data)
      // Reload to update clock progress
      loadData()
    })

    // Cleanup on unmount
    return () => {
      pusherClient.unsubscribe(`campaign-${campaignId}`)
    }
  }, [campaignId])

  const handleSubmitAction = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentScene || !selectedCharacterId || !actionText.trim()) return

    setSubmitting(true)
    setError('')
    setSuccess('')

    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/scene`, {
        method: 'POST',
        body: JSON.stringify({
          sceneId: currentScene.id,
          characterId: selectedCharacterId,
          actionText: actionText.trim()
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to submit action')
      }

      setSuccess('Action submitted!')
      setActionText('')
      await loadData() // Reload to show new action
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit action')
    } finally {
      setSubmitting(false)
    }
  }

  const handleResolveScene = async () => {
    if (!currentScene) return

    setResolving(true)
    setError('')
    setSuccess('')

    try {
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/resolve-scene`,
        { method: 'POST' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to resolve scene')
      }

      setSuccess('Scene resolved! The AI GM has processed all actions.')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve scene')
    } finally {
      setResolving(false)
    }
  }

  const handleStartNewScene = async () => {
    setError('')
    setSuccess('')

    try {
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/start-scene`,
        { method: 'POST' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to start scene')
      }

      setSuccess('New scene started!')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scene')
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    )
  }

  const selectedCharacter = userCharacters.find(c => c.id === selectedCharacterId)

  return (
    <div className="max-w-7xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Story Column */}
        <div className="lg:col-span-3 space-y-6">
          {/* Status Messages */}
          {error && (
            <div className="bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-500/10 border border-green-500 text-green-400 px-4 py-3 rounded-lg">
              {success}
            </div>
          )}

          {/* Current Scene */}
          {currentScene ? (
            <>
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-white">
                    Scene {currentScene.sceneNumber}
                  </h2>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    currentScene.status === 'AWAITING_ACTIONS'
                      ? 'bg-green-500/20 text-green-400'
                      : currentScene.status === 'RESOLVING'
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-gray-700 text-gray-400'
                  }`}>
                    {currentScene.status.replace('_', ' ')}
                  </span>
                </div>

                <div className="prose prose-invert max-w-none">
                  <p className="text-gray-300 whitespace-pre-wrap leading-relaxed">
                    {currentScene.sceneIntroText}
                  </p>
                </div>

                {/* Show resolution if resolved */}
                {currentScene.sceneResolutionText && (
                  <div className="mt-6 pt-6 border-t border-gray-700">
                    <h3 className="text-lg font-bold text-primary-400 mb-3">
                      Resolution
                    </h3>
                    <p className="text-gray-300 whitespace-pre-wrap leading-relaxed">
                      {currentScene.sceneResolutionText}
                    </p>
                  </div>
                )}
              </div>

              {/* Player Actions */}
              {currentScene.actions && currentScene.actions.length > 0 && (
                <div className="card">
                  <h3 className="text-lg font-bold text-white mb-4">Player Actions</h3>
                  <div className="space-y-3">
                    {currentScene.actions.map((action: any) => (
                      <div key={action.id} className="bg-gray-900 rounded-lg p-4">
                        <div className="flex items-start justify-between mb-2">
                          <span className="font-medium text-primary-400">
                            {action.character.name}
                          </span>
                          <span className="text-xs text-gray-500">
                            {new Date(action.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-gray-300 text-sm">{action.actionText}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Form (if scene is awaiting actions) */}
              {currentScene.status === 'AWAITING_ACTIONS' && userCharacters.length > 0 && (
                <div className="card">
                  <h3 className="text-lg font-bold text-white mb-4">Your Action</h3>
                  <form onSubmit={handleSubmitAction} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Character
                      </label>
                      <select
                        value={selectedCharacterId}
                        onChange={(e) => setSelectedCharacterId(e.target.value)}
                        className="input-field"
                      >
                        {userCharacters.map(char => (
                          <option key={char.id} value={char.id}>
                            {char.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        What do you do?
                      </label>
                      <textarea
                        value={actionText}
                        onChange={(e) => setActionText(e.target.value)}
                        className="input-field min-h-[100px]"
                        placeholder={
                          selectedCharacterId
                            ? `What does ${userCharacters.find(c => c.id === selectedCharacterId)?.name || 'your character'} do? Be specific about their actions, intentions, and approach...`
                            : "Describe your character's action in detail..."
                        }
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="btn-primary w-full disabled:opacity-50"
                    >
                      {submitting ? 'Submitting...' : 'Submit Action'}
                    </button>
                  </form>
                </div>
              )}

              {/* Admin Controls */}
              {isAdmin && currentScene.status === 'AWAITING_ACTIONS' && (
                <div className="card bg-primary-500/10 border-primary-500/50">
                  <h3 className="text-lg font-bold text-primary-400 mb-4">
                    🎭 Admin Controls
                  </h3>
                  <p className="text-gray-300 text-sm mb-4">
                    {!currentScene.actions || currentScene.actions.length === 0
                      ? 'Waiting for players to submit actions...'
                      : `${currentScene.actions.length} action(s) submitted. Ready to resolve?`}
                  </p>
                  <button
                    onClick={handleResolveScene}
                    disabled={resolving || !currentScene.actions || currentScene.actions.length === 0}
                    className="btn-primary disabled:opacity-50"
                  >
                    {resolving ? 'Resolving with AI GM...' : '🤖 Resolve Scene (AI GM)'}
                  </button>
                </div>
              )}

              {/* Start New Scene (if current is resolved) */}
              {isAdmin && currentScene.status === 'RESOLVED' && (
                <div className="card bg-primary-500/10 border-primary-500/50">
                  <h3 className="text-lg font-bold text-primary-400 mb-4">
                    Scene Complete
                  </h3>
                  <p className="text-gray-300 text-sm mb-4">
                    This scene has been resolved. Start a new scene to continue the story.
                  </p>
                  <button
                    onClick={handleStartNewScene}
                    className="btn-primary"
                  >
                    🎬 Start New Scene
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="card text-center py-12">
              <div className="text-6xl mb-4">📜</div>
              <h2 className="text-xl font-bold text-white mb-2">No Active Scene</h2>
              <p className="text-gray-400 mb-6">
                {isAdmin
                  ? 'Start a new scene to begin the adventure'
                  : 'Waiting for the GM to start a scene'}
              </p>
              {isAdmin && (
                <button onClick={handleStartNewScene} className="btn-primary">
                  🎬 Start First Scene
                </button>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Your Character */}
          {selectedCharacter && (
            <div className="card">
              <h3 className="text-sm font-bold text-gray-400 mb-3">YOUR CHARACTER</h3>
              <div className="space-y-2">
                <h4 className="font-bold text-white text-lg">{selectedCharacter.name}</h4>
                <p className="text-sm text-gray-400">{selectedCharacter.concept}</p>
                {selectedCharacter.currentLocation && (
                  <p className="text-xs text-gray-500">
                    📍 {selectedCharacter.currentLocation}
                  </p>
                )}
                {Array.isArray(selectedCharacter.conditions) &&
                  selectedCharacter.conditions.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 mb-1">Conditions:</p>
                      <div className="flex flex-wrap gap-1">
                        {selectedCharacter.conditions.map((cond: string, i: number) => (
                          <span
                            key={i}
                            className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs"
                          >
                            {cond}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            </div>
          )}

          {/* Active Clocks */}
          {campaign?.campaign?.clocks && campaign.campaign.clocks.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-bold text-gray-400 mb-3">ACTIVE CLOCKS</h3>
              <div className="space-y-3">
                {campaign.campaign.clocks.map((clock: any) => (
                  <div key={clock.id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-white">{clock.name}</span>
                      <span className="text-xs text-gray-500">
                        {clock.currentTicks}/{clock.maxTicks}
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-primary-500 h-2 rounded-full transition-all"
                        style={{
                          width: `${(clock.currentTicks / clock.maxTicks) * 100}%`
                        }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{clock.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Timeline */}
          {campaign?.campaign?.timeline &&
            campaign.campaign.timeline.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-bold text-gray-400 mb-3">RECENT EVENTS</h3>
                <div className="space-y-2">
                  {campaign.campaign.timeline.slice(0, 5).map((event: any) => (
                    <div key={event.id} className="text-sm">
                      <p className="font-medium text-white">{event.title}</p>
                      <p className="text-xs text-gray-500">Turn {event.turnNumber}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}
