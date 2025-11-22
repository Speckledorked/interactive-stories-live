// src/app/campaigns/[id]/story/page.tsx
// Main story view - where the game happens!

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { authenticatedFetch, isAuthenticated, getUser } from '@/lib/clientAuth'
import { pusherClient } from '@/lib/pusher'
import ChatPanel from '@/components/chat/ChatPanel'
import { PlayerMapViewer } from '@/components/maps/PlayerMapViewer'
import type { MapData } from '@/lib/maps/map-service'
import AILoadingState from '@/components/scene/AILoadingState'
import SceneMoodTag, { detectSceneMood } from '@/components/scene/SceneMoodTag'
import { CompactClock } from '@/components/clock/ClockProgress'
import { CompactTimeline } from '@/components/scene/VisualTimeline'
import AITransparencyPanel, { type WorldStateChange } from '@/components/scene/AITransparencyPanel'
import CharacterSnapshotModal from '@/components/character/CharacterSnapshotModal'
import NPCRelationshipHints, { extractNPCHintsFromScene } from '@/components/scene/NPCRelationshipHints'
import { useCommandPalette } from '@/contexts/CommandPaletteContext'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import KeyboardShortcutsModal from '@/components/KeyboardShortcutsModal'
import SimpleXCard from '@/components/safety/SimpleXCard'

export default function StoryPage() {
  const router = useRouter()
  const params = useParams()
  const campaignId = params.id as string

  const [campaign, setCampaign] = useState<any>(null)
  const [currentScene, setCurrentScene] = useState<any>(null)
  const [activeScenes, setActiveScenes] = useState<any[]>([])
  const [userCharacters, setUserCharacters] = useState<any[]>([])
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('')
  const [actionText, setActionText] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({})
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [expandedActions, setExpandedActions] = useState<Record<string, boolean>>({})
  const [activeMap, setActiveMap] = useState<MapData | null>(null)
  const [showMap, setShowMap] = useState(true)
  const [showCharacterSnapshot, setShowCharacterSnapshot] = useState(false)
  const [sceneWorldStateChanges, setSceneWorldStateChanges] = useState<Record<string, WorldStateChange[]>>({})
  const [expandedTransparency, setExpandedTransparency] = useState<Record<string, boolean>>({})
  const [startingScene, setStartingScene] = useState(false)
  const [endingScene, setEndingScene] = useState(false)
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)

  const user = getUser()
  const isAdmin = campaign?.userRole === 'ADMIN'

  // Command palette context
  const { setContext, registerAction } = useCommandPalette()

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

      // Load active scenes
      const sceneResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/scene`)
      if (!sceneResponse.ok) throw new Error('Failed to load scenes')
      const sceneData = await sceneResponse.json()
      setCurrentScene(sceneData.scene)
      setActiveScenes(sceneData.scenes || [])

      // Load world state changes for scenes
      const changesMap: Record<string, WorldStateChange[]> = {}
      for (const scene of sceneData.scenes || []) {
        if (scene.consequences?.worldStateChanges) {
          changesMap[scene.id] = scene.consequences.worldStateChanges
        }
      }
      setSceneWorldStateChanges(changesMap)

      // Get user's characters
      const userChars = campData.campaign?.characters?.filter(
        (c: any) => c.userId === user?.id
      ) || []
      setUserCharacters(userChars)
      if (userChars.length > 0 && !selectedCharacterId) {
        setSelectedCharacterId(userChars[0].id)
      }

      // Load active map
      try {
        const mapResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/maps/active`)
        if (mapResponse.ok) {
          const mapData = await mapResponse.json()
          setActiveMap(mapData.map)
        }
      } catch (mapErr) {
        // Map loading is optional, don't fail the whole page
        console.error('Failed to load map:', mapErr)
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

    // Listen for map updates
    channel.bind('ai-map-generated', (data: any) => {
      console.log('Map generated:', data)
      setActiveMap(data.map)
    })

    channel.bind('ai-character-moved', (data: any) => {
      console.log('Character moved:', data)
      // Reload map to get updated token positions
      loadData()
    })

    channel.bind('ai-element-added', (data: any) => {
      console.log('Element added to map:', data)
      loadData()
    })

    channel.bind('ai-element-removed', (data: any) => {
      console.log('Element removed from map:', data)
      loadData()
    })

    // Cleanup on unmount
    return () => {
      pusherClient.unsubscribe(`campaign-${campaignId}`)
    }
  }, [campaignId])

  // Set command palette context
  useEffect(() => {
    setContext({ campaignId, sceneId: currentScene?.id })
  }, [campaignId, currentScene?.id, setContext])

  // Register command palette actions
  useEffect(() => {
    registerAction('submit-action', () => {
      const firstScene = activeScenes[0]
      if (firstScene) {
        const formEvent = new Event('submit') as any
        handleSubmitAction(formEvent, firstScene.id)
      }
    })

    registerAction('resolve-exchange', () => {
      if (currentScene) handleResolveScene(currentScene.id)
    })

    registerAction('end-scene', () => {
      if (currentScene) handleEndScene(currentScene.id)
    })

    registerAction('create-character', () => {
      router.push(`/campaigns/${campaignId}`)
    })

    registerAction('show-shortcuts', () => {
      setShowKeyboardShortcuts(true)
    })
  }, [activeScenes, currentScene, registerAction, campaignId, router])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    campaignId,
    onSubmitAction: () => {
      const firstScene = activeScenes[0]
      if (firstScene && selectedCharacterId && actionText[firstScene.id]?.trim()) {
        const formEvent = { preventDefault: () => {} } as React.FormEvent
        handleSubmitAction(formEvent, firstScene.id)
      }
    },
    onResolveExchange: () => {
      if (currentScene && isAdmin) handleResolveScene(currentScene.id)
    },
    onEndScene: () => {
      if (currentScene && isAdmin) handleEndScene(currentScene.id)
    },
    onStartScene: () => {
      if (isAdmin) handleStartNewScene()
    },
    onShowShortcuts: () => {
      setShowKeyboardShortcuts(true)
    }
  })

  const handleSubmitAction = async (e: React.FormEvent, sceneId: string) => {
    e.preventDefault()
    if (!sceneId || !selectedCharacterId || !actionText[sceneId]?.trim()) return

    setSubmitting(prev => ({ ...prev, [sceneId]: true }))
    setError('')
    setSuccess('')

    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/scene`, {
        method: 'POST',
        body: JSON.stringify({
          sceneId,
          characterId: selectedCharacterId,
          actionText: actionText[sceneId].trim()
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to submit action')
      }

      setSuccess('Action submitted! The AI GM will resolve when all participants submit.')
      setActionText(prev => ({ ...prev, [sceneId]: '' }))
      await loadData() // Reload to show new action
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit action')
    } finally {
      setSubmitting(prev => ({ ...prev, [sceneId]: false }))
    }
  }

  const handleResolveScene = async (sceneId?: string) => {
    const targetSceneId = sceneId || currentScene?.id
    if (!targetSceneId) return

    setResolving(true)
    setError('')
    setSuccess('')

    try {
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/resolve-scene`,
        {
          method: 'POST',
          body: JSON.stringify({ sceneId: targetSceneId })
        }
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

  const [startingScene, setStartingScene] = useState(false)
  const [endingScene, setEndingScene] = useState(false)

  const handleStartNewScene = async () => {
    setError('')
    setSuccess('')
    setStartingScene(true)

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
    } finally {
      setStartingScene(false)
    }
  }

  const handleEndScene = async (sceneId: string) => {
    setError('')
    setSuccess('')
    setEndingScene(true)

    try {
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/end-scene`,
        {
          method: 'POST',
          body: JSON.stringify({ sceneId })
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to end scene')
      }

      setSuccess('Scene ended!')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end scene')
    } finally {
      setEndingScene(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <AILoadingState type="scene" />
      </div>
    )
  }

  const selectedCharacter = userCharacters.find(c => c.id === selectedCharacterId)

  // Helper to check if a character can participate in a scene
  const canParticipateInScene = (scene: any, characterId: string) => {
    const participants = scene.participants as any
    // If no participants set, it's an open scene (backwards compatibility)
    if (!participants || !participants.characterIds || participants.characterIds.length === 0) {
      return true
    }
    // Check if character is in the participant list
    return participants.characterIds.includes(characterId)
  }

  // Helper to check if user has already submitted action in a scene
  const hasUserSubmitted = (scene: any) => {
    return scene.playerActions?.some((action: any) =>
      action.userId === user?.id && action.characterId === selectedCharacterId
    )
  }

  // Filter scenes where the selected character can participate
  const availableScenes = activeScenes.filter(scene =>
    selectedCharacterId && canParticipateInScene(scene, selectedCharacterId)
  )

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Navigation Bar */}
      <div className="mb-6">
        <Link
          href="/campaigns"
          className="text-gray-400 hover:text-white transition-colors text-sm mb-3 inline-block"
        >
          ← Back to Campaigns
        </Link>

        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-bold text-white">{campaign?.campaign?.name}</h1>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between gap-4 border-b border-gray-700 pb-2">
          <div className="flex gap-2 overflow-x-auto">
            <Link
              href={`/campaigns/${campaignId}`}
              className="px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-t transition-colors whitespace-nowrap"
            >
              Overview
            </Link>
            <span className="px-4 py-2 bg-primary-600 text-white rounded-t whitespace-nowrap">
              Story
            </span>
            <Link
              href={`/campaigns/${campaignId}/story-log`}
              className="px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-t transition-colors whitespace-nowrap"
            >
              Story Log
            </Link>
            <Link
              href={`/campaigns/${campaignId}`}
              className="px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-t transition-colors whitespace-nowrap"
            >
              Notes
            </Link>
            <Link
              href={`/campaigns/${campaignId}`}
              className="px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-t transition-colors whitespace-nowrap"
            >
              Maps
            </Link>
            <Link
              href={`/campaigns/${campaignId}`}
              className="px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-t transition-colors whitespace-nowrap"
            >
              Chat
            </Link>
            {isAdmin && (
              <Link
                href={`/campaigns/${campaignId}/admin`}
                className="px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-t transition-colors whitespace-nowrap"
              >
                ⚙️ Admin
              </Link>
            )}
          </div>
          <div className="flex items-center gap-3">
            <SimpleXCard campaignId={campaignId} sceneId={currentScene?.id} />
            <button
              onClick={() => setShowKeyboardShortcuts(true)}
              className="flex items-center gap-2 px-3 py-1 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors whitespace-nowrap"
              title="Keyboard shortcuts"
            >
              <span>⌨️</span>
              <kbd className="hidden sm:inline px-1.5 py-0.5 text-xs bg-gray-700 rounded border border-gray-600">
                ?
              </kbd>
            </button>
          </div>
        </div>
      </div>

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

          {/* Active Scenes */}
          {availableScenes.length > 0 ? (
            availableScenes.map(scene => {
              const userHasSubmitted = hasUserSubmitted(scene)
              const waitingOn = (scene.waitingOnUsers as any) || []
              const isWaitingOnUser = waitingOn.includes(user?.id)

              return (
                <div key={scene.id} className="space-y-4">
                  <div className="card">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold text-white">
                          Scene {scene.sceneNumber}
                        </h2>
                        {/* Scene mood indicators */}
                        <div className="flex gap-2">
                          {detectSceneMood(scene.sceneIntroText).map((mood, idx) => (
                            <SceneMoodTag key={idx} mood={mood} />
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          scene.status === 'AWAITING_ACTIONS'
                            ? 'bg-green-500/20 text-green-400'
                            : scene.status === 'RESOLVING'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-gray-700 text-gray-400'
                        }`}>
                          {scene.status.replace('_', ' ')}
                        </span>
                        {scene.status === 'RESOLVING' && (
                          <AILoadingState type="resolution" />
                        )}
                      </div>
                    </div>

                    <div className="prose prose-invert max-w-none">
                      <p className="text-gray-300 whitespace-pre-wrap leading-relaxed">
                        {scene.sceneIntroText}
                      </p>
                    </div>

                    {/* NPC Relationship Hints */}
                    {campaign?.campaign?.npcs && campaign.campaign.npcs.length > 0 && (
                      <div className="mt-4">
                        <NPCRelationshipHints
                          hints={extractNPCHintsFromScene(
                            scene.sceneIntroText,
                            campaign.campaign.npcs.map((n: any) => ({ name: n.name, id: n.id }))
                          )}
                        />
                      </div>
                    )}

                    {/* Show resolutions if any exist */}
                    {scene.sceneResolutionText && (
                      <>
                        <div className="mt-6 pt-6 border-t border-gray-700">
                          <h3 className="text-lg font-bold text-primary-400 mb-3">
                            {scene.sceneResolutionText.includes('---') ? 'Resolutions' : 'Resolution'}
                          </h3>
                          {/* Split multiple resolutions by separator */}
                          {scene.sceneResolutionText.split('\n\n---\n\n').map((resolution: string, idx: number) => (
                            <div key={idx} className={idx > 0 ? 'mt-6 pt-6 border-t border-gray-600' : ''}>
                              {scene.sceneResolutionText.includes('---') && (
                                <h4 className="text-sm font-medium text-gray-400 mb-2">
                                  Exchange {idx + 1}
                                </h4>
                              )}
                              <p className="text-gray-300 whitespace-pre-wrap leading-relaxed">
                                {resolution}
                              </p>

                              {/* NPC Relationship Hints in Resolution */}
                              {campaign?.campaign?.npcs && campaign.campaign.npcs.length > 0 && (
                                <div className="mt-4">
                                  <NPCRelationshipHints
                                    hints={extractNPCHintsFromScene(
                                      resolution,
                                      campaign.campaign.npcs.map((n: any) => ({ name: n.name, id: n.id }))
                                    )}
                                  />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* AI Transparency Panel - Show world state changes */}
                        {sceneWorldStateChanges[scene.id] && sceneWorldStateChanges[scene.id].length > 0 && (
                          <div className="mt-4">
                            <AITransparencyPanel
                              changes={sceneWorldStateChanges[scene.id]}
                              sceneNumber={scene.sceneNumber}
                              isOpen={expandedTransparency[scene.id] !== false}
                              onClose={() => setExpandedTransparency(prev => ({ ...prev, [scene.id]: false }))}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Player Actions - Collapsible */}
                  {scene.playerActions && scene.playerActions.length > 0 && (
                    <div className="card">
                      <button
                        onClick={() => setExpandedActions(prev => ({ ...prev, [scene.id]: !prev[scene.id] }))}
                        className="w-full flex items-center justify-between text-left"
                      >
                        <h3 className="text-lg font-bold text-white">
                          Player Actions ({scene.playerActions.length})
                        </h3>
                        <span className="text-gray-400">
                          {expandedActions[scene.id] ? '▼' : '▶'}
                        </span>
                      </button>
                      {expandedActions[scene.id] && (
                        <div className="space-y-3 mt-4">
                          {scene.playerActions.map((action: any) => (
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
                      )}
                    </div>
                  )}

                  {/* Action Form (if scene is awaiting actions and user hasn't submitted) */}
                  {scene.status === 'AWAITING_ACTIONS' && !userHasSubmitted && selectedCharacterId && (
                    <div className="card">
                      <h3 className="text-lg font-bold text-white mb-4">Your Action</h3>
                      {isWaitingOnUser && (
                        <div className="bg-blue-500/10 border border-blue-500 text-blue-400 px-3 py-2 rounded-lg mb-4 text-sm">
                          ⏳ Waiting for your action...
                        </div>
                      )}
                      <form onSubmit={(e) => handleSubmitAction(e, scene.id)} className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-300 mb-2">
                            What do you do?
                          </label>
                          <textarea
                            value={actionText[scene.id] || ''}
                            onChange={(e) => setActionText(prev => ({ ...prev, [scene.id]: e.target.value }))}
                            className="input-field min-h-[100px]"
                            placeholder={`What does ${selectedCharacter?.name || 'your character'} do? Be specific about their actions, intentions, and approach...`}
                            required
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={submitting[scene.id]}
                          className="btn-primary w-full disabled:opacity-50"
                        >
                          {submitting[scene.id] ? 'Submitting...' : 'Submit Action'}
                        </button>
                      </form>
                    </div>
                  )}

                  {/* User already submitted */}
                  {scene.status === 'AWAITING_ACTIONS' && userHasSubmitted && (
                    <div className="card bg-green-500/10 border-green-500/50">
                      <p className="text-green-400 text-sm">
                        ✓ You've submitted your action. Waiting for other participants...
                      </p>
                    </div>
                  )}

                  {/* GM Controls (Admin Only) */}
                  {scene.status === 'AWAITING_ACTIONS' && isAdmin && scene.playerActions && scene.playerActions.length > 0 && (
                    <div className="card bg-yellow-500/10 border-yellow-500/50">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <p className="text-yellow-400 text-sm font-medium mb-1">
                            🎲 GM Controls
                          </p>
                          <p className="text-gray-400 text-xs mb-2">
                            {scene.playerActions.length} action(s) submitted. Current exchange: {scene.currentExchange || 1}
                          </p>
                          <p className="text-gray-500 text-xs">
                            Resolving will process actions and continue the scene. End the scene when the story concludes.
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleResolveScene(scene.id)}
                            disabled={resolving}
                            className="btn-primary disabled:opacity-50 whitespace-nowrap"
                          >
                            {resolving ? 'Resolving...' : 'Resolve Exchange'}
                          </button>
                          <button
                            onClick={() => handleEndScene(scene.id)}
                            disabled={endingScene}
                            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                          >
                            {endingScene ? 'Ending...' : 'End Scene'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
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
                <button
                  onClick={handleStartNewScene}
                  disabled={startingScene}
                  className="btn-primary disabled:opacity-50"
                >
                  {startingScene ? 'Starting...' : '🎬 Start First Scene'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Character Selector */}
          {userCharacters.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-bold text-gray-400 mb-3">SELECT CHARACTER</h3>
              <select
                value={selectedCharacterId}
                onChange={(e) => setSelectedCharacterId(e.target.value)}
                className="input-field w-full"
              >
                <option value="">Choose a character...</option>
                {userCharacters.map(char => (
                  <option key={char.id} value={char.id}>
                    {char.name}
                  </option>
                ))}
              </select>
              {selectedCharacter && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <h4 className="font-bold text-white text-lg">{selectedCharacter.name}</h4>
                      <p className="text-sm text-gray-400">{selectedCharacter.concept}</p>
                    </div>
                    <button
                      onClick={() => setShowCharacterSnapshot(true)}
                      className="px-2 py-1 bg-primary-600 hover:bg-primary-700 text-white rounded text-xs font-medium transition-colors"
                      title="Quick Reference"
                    >
                      👁️ View
                    </button>
                  </div>
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
              )}
            </div>
          )}

          {/* Map Viewer */}
          {activeMap && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-400">MAP</h3>
                <button
                  onClick={() => setShowMap(!showMap)}
                  className="text-xs text-gray-500 hover:text-white transition-colors"
                >
                  {showMap ? 'Hide' : 'Show'}
                </button>
              </div>
              {showMap && (
                <div className="rounded-lg overflow-hidden border border-gray-700">
                  <PlayerMapViewer
                    map={activeMap}
                    characterName={selectedCharacter?.name || ''}
                  />
                </div>
              )}
            </div>
          )}

          {/* In-Character Chat for Current Scene */}
          {currentScene && user && (
            <div className="card p-0">
              <ChatPanel
                campaignId={campaignId}
                currentUserId={user.id}
                currentUserName={user.email}
                userCharacters={userCharacters}
                sceneId={currentScene.id}
                icOnly={true}
              />
            </div>
          )}

          {/* Active Clocks */}
          {campaign?.campaign?.clocks && campaign.campaign.clocks.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-bold text-gray-400 mb-3">ACTIVE CLOCKS</h3>
              <div className="space-y-2">
                {campaign.campaign.clocks
                  .filter((clock: any) => !clock.isHidden)
                  .map((clock: any) => (
                    <CompactClock
                      key={clock.id}
                      name={clock.name}
                      current={clock.currentTicks}
                      max={clock.maxTicks}
                    />
                  ))}
              </div>
            </div>
          )}

          {/* Recent Timeline */}
          {campaign?.campaign?.timeline &&
            campaign.campaign.timeline.length > 0 && (
              <div className="card p-0">
                <CompactTimeline events={campaign.campaign.timeline.slice(0, 5)} />
              </div>
            )}
        </div>
      </div>

      {/* Character Snapshot Modal */}
      {selectedCharacterId && (
        <CharacterSnapshotModal
          characterId={selectedCharacterId}
          campaignId={campaignId}
          isOpen={showCharacterSnapshot}
          onClose={() => setShowCharacterSnapshot(false)}
        />
      )}

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={showKeyboardShortcuts}
        onClose={() => setShowKeyboardShortcuts(false)}
      />
    </div>
  )
}
