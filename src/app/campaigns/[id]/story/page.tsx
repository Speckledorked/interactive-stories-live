// src/app/campaigns/[id]/story/page.tsx
// Main story view - where the game happens!

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { authenticatedFetch, isAuthenticated, getUser, setLastCampaignId } from '@/lib/clientAuth'
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
import { Home, Scroll, StickyNote, Map as MapIcon, MessageSquare, Settings as SettingsIcon, Keyboard, Eye } from 'lucide-react'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'

export default function StoryPage() {
  const router = useRouter()
  const params = useParams()
  const campaignId = params.id as string

  const [campaign, setCampaign] = useState<any>(null)
  const [currentScene, setCurrentScene] = useState<any>(null)
  const [activeScenes, setActiveScenes] = useState<any[]>([])
  const [resolvedScenes, setResolvedScenes] = useState<any[]>([])
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
  const [showSceneOptions, setShowSceneOptions] = useState(false)
  const [selectedSceneCharacters, setSelectedSceneCharacters] = useState<string[]>([])
  const [showInsufficientFunds, setShowInsufficientFunds] = useState(false)
  const [insufficientFundsDetails, setInsufficientFundsDetails] = useState('')
  const [addFundsLoading, setAddFundsLoading] = useState(false)
  const [addFundsError, setAddFundsError] = useState('')
  const [resolvingMessage, setResolvingMessage] = useState('')

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
      setLastCampaignId(campaignId)

      // Load active scenes
      const sceneResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/scene`)
      if (!sceneResponse.ok) throw new Error('Failed to load scenes')
      const sceneData = await sceneResponse.json()
      setCurrentScene(sceneData.scene)
      setActiveScenes(sceneData.scenes || [])

      // Load all scenes to find resolved ones
      try {
        const allScenesResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/scenes`)
        if (allScenesResponse.ok) {
          const allScenesData = await allScenesResponse.json()
          const resolved = allScenesData.scenes?.filter((s: any) => s.status === 'RESOLVED') || []
          setResolvedScenes(resolved)
        }
      } catch (err) {
        console.error('Failed to load resolved scenes:', err)
        // Not critical - continue without resolved scenes
      }

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
    // Check if Pusher is configured
    if (!pusherClient) {
      console.warn('Pusher not configured - falling back to polling for updates.')
      return
    }

    // Subscribe to the campaign channel
    const channel = pusherClient.subscribe(`campaign-${campaignId}`)

    // Listen for new actions
    channel.bind('action:created', (data: any) => {
      console.log('New action created:', data)
      // Refresh data so actions list stays up to date
      loadData()
    })

    // Listen for scene resolution starting
    channel.bind('scene:resolving', (data: any) => {
      console.log('Scene resolving:', data)
      setResolvingMessage(data.message || 'The AI GM is processing your actions...')
      setError('') // Clear any previous errors
      // Refresh to show RESOLVING status
      loadData()
    })

    // Listen for scene resolutions
    channel.bind('scene:resolved', (data: any) => {
      console.log('Scene resolved:', data)
      setResolvingMessage('') // Clear resolving message
      setSuccess('')
      // Refresh data so scene resolution appears
      loadData()
    })

    // Listen for resolution failures
    channel.bind('scene:resolution-failed', (data: any) => {
      console.error('Scene resolution failed:', data)
      setResolvingMessage('') // Clear resolving message
      const isTimeout = data.error?.includes('timeout') || data.errorType === 'TimeoutError'
      const message = isTimeout
        ? `The AI GM took too long to respond. This can happen during high load. The scene is ready to try again.`
        : `Scene resolution encountered an issue: ${data.error}. The scene is ready to try again.`
      setError(message)
      loadData()
    })

    // Listen for scene resets
    channel.bind('scene:reset', (data: any) => {
      console.log('Scene reset:', data)
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
      if (pusherClient) {
        pusherClient.unsubscribe(`campaign-${campaignId}`)
      }
    }
  }, [campaignId])

  // Fallback polling when Pusher is not configured or scene is resolving
  useEffect(() => {
    const hasResolvingScene = activeScenes.some(scene => scene.status === 'RESOLVING')
    const hasActiveScene = activeScenes.some(scene => scene.status === 'AWAITING_ACTIONS' || scene.status === 'RESOLVING')
    // Always poll when resolving; poll every 10s as a safety net when Pusher may miss events
    const shouldPoll = hasResolvingScene || !pusherClient || hasActiveScene

    if (!shouldPoll) {
      return
    }

    // Poll every 3 seconds when a scene is resolving, 10 seconds otherwise
    const pollInterval = hasResolvingScene ? 3000 : 10000

    const pollTimer = setInterval(() => {
      // Silently poll for updates
      loadData()
    }, pollInterval)

    return () => {
      clearInterval(pollTimer)
    }
  }, [campaignId, activeScenes, pusherClient])

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
        if (response.status === 402) {
          setInsufficientFundsDetails(data.details || 'You need to add funds to submit actions.')
          setShowInsufficientFunds(true)
          return
        }
        throw new Error(data.error || 'Failed to submit action')
      }

      // Check if this scene has predefined participants for better success message
      const scene = activeScenes.find(s => s.id === sceneId)
      const participants = scene?.participants as any
      const hasDefinedParticipants = participants?.characterIds && participants.characterIds.length > 0

      setSuccess(
        hasDefinedParticipants
          ? '✓ Action submitted! The scene will auto-resolve when all participants submit.'
          : '✓ Action submitted! Waiting for GM to resolve this exchange.'
      )
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

        // Check if it's an insufficient funds error (402 Payment Required)
        if (response.status === 402) {
          setInsufficientFundsDetails(data.details || 'You need to add funds to resolve this scene.')
          setShowInsufficientFunds(true)
          return
        }

        throw new Error(data.error || 'Failed to resolve scene')
      }

      setSuccess('Resolution started — the GM is writing. Results will appear here shortly.')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve scene')
    } finally {
      setResolving(false)
    }
  }

  const handleStartNewScene = async (characterIds?: string[]) => {
    setError('')
    setSuccess('')
    setStartingScene(true)

    try {
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/start-scene`,
        {
          method: 'POST',
          body: JSON.stringify({ characterIds })
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to start scene')
      }

      setSuccess('New scene started!')
      setShowSceneOptions(false)
      setSelectedSceneCharacters([])
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scene')
    } finally {
      setStartingScene(false)
    }
  }

  const handleAddFundsFromModal = async () => {
    setAddFundsLoading(true)
    setAddFundsError('')
    try {
      const response = await authenticatedFetch('/api/user/balance/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountInCents: 100 }), // default $1.00
      })
      const data = await response.json()
      if (response.ok && data.checkoutUrl) {
        window.location.href = data.checkoutUrl
      } else {
        setAddFundsError(data.error || 'Failed to start checkout')
        setAddFundsLoading(false)
      }
    } catch {
      setAddFundsError('Failed to start checkout. Please try again.')
      setAddFundsLoading(false)
    }
  }

  const handleContinueStory = () => {
    handleStartNewScene() // No character IDs - AI chooses based on story flow
  }

  const handleCharacterFocusedScene = () => {
    if (selectedSceneCharacters.length === 0) {
      setError('Please select at least one character')
      return
    }
    handleStartNewScene(selectedSceneCharacters)
  }

  const handleFullPartyScene = () => {
    const allCharacterIds = campaign?.characters?.map((c: any) => c.id) || []
    if (allCharacterIds.length === 0) {
      setError('No characters available')
      return
    }
    handleStartNewScene(allCharacterIds)
  }

  const toggleCharacterSelection = (characterId: string) => {
    setSelectedSceneCharacters(prev =>
      prev.includes(characterId)
        ? prev.filter(id => id !== characterId)
        : [...prev, characterId]
    )
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

  const handleResetScene = async (sceneId: string) => {
    if (!confirm('Are you sure you want to reset this stuck scene? This will set it back to AWAITING_ACTIONS state.')) {
      return
    }

    setError('')
    setSuccess('')

    try {
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/scenes/${sceneId}/reset`,
        {
          method: 'POST'
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to reset scene')
      }

      setSuccess('Scene has been reset! You can now try resolving again.')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset scene')
    }
  }

  if (loading) {
    return (
      <TavernPage>
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Loading…" campaignId={campaignId} />
        <main className="max-w-7xl mx-auto px-4 pt-28 pb-16 flex justify-center items-center min-h-[60vh]">
          <AILoadingState type="scene" />
        </main>
      </TavernPage>
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

  // Helper to check if user has already submitted action in the current exchange
  const hasUserSubmitted = (scene: any) => {
    const currentExchange = scene.currentExchange || 1
    return scene.playerActions?.some((action: any) =>
      action.userId === user?.id &&
      action.characterId === selectedCharacterId &&
      action.exchangeNumber === currentExchange
    )
  }

  // Filter scenes where the selected character can participate
  const availableScenes = activeScenes.filter(scene =>
    selectedCharacterId && canParticipateInScene(scene, selectedCharacterId)
  )

  const getCurrentStageText = (scene: any) => {
    // Only show intro text here - resolutions are displayed in the dedicated resolutions section
    return scene.sceneIntroText
  }

  const storyTabs = [
    { key: 'overview', label: 'Overview', icon: Home, href: `/campaigns/${campaignId}` },
    { key: 'story', label: 'Story', icon: Scroll, href: null },
    { key: 'story-log', label: 'Story Log', icon: Scroll, href: `/campaigns/${campaignId}/story-log` },
    { key: 'notes', label: 'Notes', icon: StickyNote, href: `/campaigns/${campaignId}?tab=notes` },
    { key: 'maps', label: 'Maps', icon: MapIcon, href: `/campaigns/${campaignId}?tab=maps` },
    { key: 'chat', label: 'Chat', icon: MessageSquare, href: `/campaigns/${campaignId}?tab=chat` },
    ...(isAdmin ? [{ key: 'admin', label: 'Admin', icon: SettingsIcon, href: `/campaigns/${campaignId}/admin` }] : []),
  ]

  return (
    <TavernPage>
      <TavernHeader
        backHref={`/campaigns/${campaignId}`}
        title={campaign?.campaign?.name || 'Story'}
        campaignId={campaignId}
        isAdmin={isAdmin}
        subrow={
          <div className="max-w-7xl mx-auto px-4 flex items-center justify-between gap-3 border-t border-ember-900/20 pt-2 pb-0">
            <nav className="flex items-center gap-1 overflow-x-auto text-sm">
              {storyTabs.map((tab) => {
                const isActive = tab.key === 'story'
                const content = (
                  <span
                    className={`flex items-center gap-1.5 px-2.5 py-2 border-b-2 whitespace-nowrap flex-shrink-0 transition-colors ${
                      isActive ? 'border-ember-400 text-ember-200' : 'border-transparent text-ember-300/40 hover:text-ember-300/70'
                    }`}
                  >
                    <tab.icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </span>
                )
                return tab.href ? (
                  <Link key={tab.key} href={tab.href}>{content}</Link>
                ) : (
                  <span key={tab.key}>{content}</span>
                )
              })}
            </nav>
            <div className="flex items-center gap-1 flex-shrink-0 pb-1.5">
              <SimpleXCard campaignId={campaignId} sceneId={currentScene?.id} />
              <button
                onClick={() => setShowKeyboardShortcuts(true)}
                className="p-1.5 text-ember-300/60 hover:text-ember-100 transition-colors"
                title="Keyboard shortcuts"
              >
                <Keyboard className="w-4 h-4" />
              </button>
            </div>
          </div>
        }
      />

      <main className="max-w-7xl mx-auto px-4 pt-28 pb-28">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Story Column */}
        <div className="lg:col-span-3 space-y-6">
          {/* Status Messages */}
          {error && (
            <div className="bg-wine-800/20 border border-wine-600/40 text-wine-400 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-success-500/10 border border-success-500/60 text-success-400 px-4 py-3 rounded-lg">
              {success}
            </div>
          )}
          {resolvingMessage && (
            <div className="bg-ember-900/20 border border-ember-700/40 text-ember-300 px-4 py-3 rounded-lg flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-ember-600/40"></div>
              <span>{resolvingMessage}</span>
            </div>
          )}

          {/* Active Scenes */}
          {availableScenes.length > 0 ? (
            availableScenes.map(scene => {
              const userHasSubmitted = hasUserSubmitted(scene)
              const waitingOn = (scene.waitingOnUsers as any) || []
              const isWaitingOnUser = waitingOn.includes(user?.id)
              const currentStageText = getCurrentStageText(scene)

              return (
                <div key={scene.id} className="space-y-4">
                  <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold text-ember-100">
                          Scene {scene.sceneNumber}
                        </h2>
                        {/* Scene mood indicators */}
                        <div className="flex gap-2">
                          {detectSceneMood(currentStageText).map((mood, idx) => (
                            <SceneMoodTag key={idx} mood={mood} />
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          scene.status === 'AWAITING_ACTIONS'
                            ? 'bg-success-500/20 text-success-400'
                            : scene.status === 'RESOLVING'
                            ? 'bg-ember-900/30 text-ember-300'
                            : 'bg-black/30 text-ember-300/60'
                        }`}>
                          {scene.status.replace('_', ' ')}
                        </span>
                        {scene.status === 'RESOLVING' && (
                          <>
                            <AILoadingState type="resolution" />
                            {isAdmin && (
                              <button
                                onClick={() => handleResetScene(scene.id)}
                                className="text-xs px-2 py-1 bg-wine-600 hover:bg-wine-500 text-ember-100 rounded transition-colors"
                                title="Reset stuck scene"
                              >
                                Reset
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Show intro text only if no resolutions exist yet */}
                    {!scene.sceneResolutionText && (
                      <>
                        <div className="prose prose-invert max-w-none">
                          <p className="text-ember-200/80 whitespace-pre-wrap leading-relaxed">
                            {currentStageText}
                          </p>
                        </div>

                        {/* NPC Relationship Hints */}
                        {campaign?.campaign?.npcs && campaign.campaign.npcs.length > 0 && (
                          <div className="mt-4">
                            <NPCRelationshipHints
                              hints={extractNPCHintsFromScene(
                                currentStageText,
                                campaign.campaign.npcs.map((n: any) => ({ name: n.name, id: n.id }))
                              )}
                            />
                          </div>
                        )}
                      </>
                    )}

                    {/* Show resolutions if any exist */}
                    {scene.sceneResolutionText && (
                      <>
                        <div className="mt-6 pt-6 border-t border-ember-900/30">
                          <h3 className="text-lg font-bold text-ember-300 mb-3">
                            {scene.sceneResolutionText.includes('---') ? 'Resolutions' : 'Resolution'}
                          </h3>
                          {/* Split multiple resolutions by separator */}
                          {scene.sceneResolutionText.split('\n\n---\n\n').map((resolution: string, idx: number) => (
                            <div key={idx} className={idx > 0 ? 'mt-6 pt-6 border-t border-ember-900/40' : ''}>
                              {scene.sceneResolutionText.includes('---') && (
                                <h4 className="text-sm font-medium text-ember-300/60 mb-2">
                                  Exchange {idx + 1}
                                </h4>
                              )}
                              <p className="text-ember-200/80 whitespace-pre-wrap leading-relaxed">
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
                    <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
                      <button
                        onClick={() => setExpandedActions(prev => ({ ...prev, [scene.id]: !prev[scene.id] }))}
                        className="w-full flex items-center justify-between text-left"
                      >
                        <h3 className="text-lg font-bold text-ember-100">
                          Player Actions ({scene.playerActions.length})
                        </h3>
                        <span className="text-ember-300/60">
                          {expandedActions[scene.id] ? '▼' : '▶'}
                        </span>
                      </button>
                      {expandedActions[scene.id] && (
                        <div className="space-y-3 mt-4">
                          {scene.playerActions.map((action: any) => (
                            <div key={action.id} className="bg-black/30 rounded-lg p-4">
                              <div className="flex items-start justify-between mb-2">
                                <span className="font-medium text-ember-300">
                                  {action.character.name}
                                </span>
                                <span className="text-xs text-ember-400/50">
                                  {new Date(action.createdAt).toLocaleTimeString()}
                                </span>
                              </div>
                              <p className="text-ember-200/80 text-sm">{action.actionText}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action Form — shown immediately after resolution, same as the
                      first action in a scene. A "save & read later" escape hatch
                      sits alongside it rather than gating it behind an extra click
                      (it used to require clicking "Continue the scene" first,
                      which read as a dead end since neither button looked like
                      "take your turn"). */}
                  {scene.status === 'AWAITING_ACTIONS' && !userHasSubmitted && selectedCharacterId && (
                    <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
                      <div className="flex items-center justify-between gap-3 mb-4">
                        <h3 className="text-lg font-bold text-ember-100">Your Action</h3>
                        {scene.sceneResolutionText && (
                          <a
                            href={`/campaigns/${campaignId}/story-log`}
                            className="text-xs text-ember-300/60 hover:text-ember-200 transition-colors whitespace-nowrap flex items-center gap-1"
                            title="Your progress is saved — come back anytime"
                          >
                            <span>Save &amp; read later</span>
                            <span className="opacity-70">📖</span>
                          </a>
                        )}
                      </div>
                      {isWaitingOnUser && (
                        <div className="bg-ember-900/20 border border-ember-700/40 text-ember-300 px-3 py-2 rounded-lg mb-4 text-sm">
                          ⏳ Waiting for your action...
                        </div>
                      )}
                      <form onSubmit={(e) => handleSubmitAction(e, scene.id)} className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-ember-200/80 mb-2">
                            What do you do?
                          </label>
                          <textarea
                            value={actionText[scene.id] || ''}
                            onChange={(e) => setActionText(prev => ({ ...prev, [scene.id]: e.target.value }))}
                            className="px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 min-h-[100px]"
                            placeholder={`What does ${selectedCharacter?.name || 'your character'} do? Be specific about their actions, intentions, and approach...`}
                            required
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={submitting[scene.id]}
                          className="px-4 py-2.5 rounded-lg bg-gradient-to-b from-wine-500 to-wine-700 hover:from-wine-400 hover:to-wine-600 text-ember-100 font-medium border border-ember-900/50 shadow-lg shadow-black/40 transition-all text-center w-full disabled:opacity-50"
                        >
                          {submitting[scene.id] ? 'Submitting...' : 'Submit Action'}
                        </button>
                      </form>
                    </div>
                  )}

                  {/* User already submitted */}
                  {scene.status === 'AWAITING_ACTIONS' && userHasSubmitted && (
                    <div className="rounded-xl bg-success-500/10 border border-success-500/40 shadow-lg shadow-black/30 p-5">
                      <p className="text-success-400 text-sm">
                        ✓ You've submitted your action. Waiting for other participants...
                      </p>
                    </div>
                  )}

                  {/* GM Controls (Admin Only) */}
                  {scene.status === 'AWAITING_ACTIONS' && isAdmin && (() => {
                    const participants = scene.participants as any
                    const hasDefinedParticipants = participants?.characterIds && participants.characterIds.length > 0
                    const submittedUserIds = new Set((scene.playerActions || []).map((a: any) => a.userId))
                    const participantUserIds = participants?.userIds || []
                    const allParticipantsSubmitted = participantUserIds.length > 0 && participantUserIds.every((uid: string) => submittedUserIds.has(uid))

                    return (
                      <div className={`rounded-xl border shadow-lg shadow-black/30 p-5 ${hasDefinedParticipants && allParticipantsSubmitted ? 'bg-success-500/10 border-success-500/40' : 'bg-ember-900/20 border-ember-700/40'}`}>
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                          <div className="flex-1">
                            <p className={`text-sm font-medium mb-1 ${hasDefinedParticipants && allParticipantsSubmitted ? 'text-success-400' : 'text-ember-300'}`}>
                              🎲 GM Controls
                            </p>
                            <p className="text-ember-300/60 text-xs mb-2">
                              {(scene.playerActions || []).length} action(s) submitted. Current exchange: {scene.currentExchange || 1}
                            </p>
                            {hasDefinedParticipants ? (
                              allParticipantsSubmitted ? (
                                <p className="text-success-400 text-xs mb-1">
                                  ✓ All participants have submitted — resolution should start on its own. If nothing happens within a minute, resolve manually.
                                </p>
                              ) : (
                                <p className="text-ember-400/50 text-xs">
                                  ⏳ Waiting for {participantUserIds.length - submittedUserIds.size} more participant(s). Scene will auto-resolve when all submit.
                                </p>
                              )
                            ) : (
                              <p className="text-ember-400/50 text-xs">
                                This is an open scene. Manually resolve when ready or end the scene when the story concludes.
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                            {/* Always available to the admin: for open scenes it's the normal
                                resolve, before everyone submits it's a force, and after everyone
                                submits it's the rescue path for a lost auto-resolve — hiding it
                                in that state left stuck scenes with no way out. */}
                            <button
                              onClick={() => handleResolveScene(scene.id)}
                              disabled={resolving}
                              className="px-4 py-2.5 rounded-lg bg-gradient-to-b from-wine-500 to-wine-700 hover:from-wine-400 hover:to-wine-600 text-ember-100 font-medium border border-ember-900/50 shadow-lg shadow-black/40 transition-all text-center disabled:opacity-50 whitespace-nowrap touch-manipulation min-h-[44px]"
                              title={
                                !hasDefinedParticipants
                                  ? 'Manually resolve this exchange'
                                  : allParticipantsSubmitted
                                    ? 'Kick off resolution if auto-resolve did not start'
                                    : 'Force resolution before all participants submit'
                              }
                            >
                              {resolving
                                ? 'Resolving...'
                                : !hasDefinedParticipants
                                  ? 'Resolve Exchange'
                                  : allParticipantsSubmitted
                                    ? 'Resolve Now'
                                    : 'Force Resolve'}
                            </button>
                            <button
                              onClick={() => handleEndScene(scene.id)}
                              disabled={endingScene}
                              className="bg-wine-600 hover:bg-wine-500 text-ember-100 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap touch-manipulation min-h-[44px]"
                            >
                              {endingScene ? 'Ending...' : 'End Scene'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )
            })
          ) : (
            <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 px-5 py-12">
              <div className="text-center mb-8">
                <div className="text-6xl mb-4">📜</div>
                <h2 className="text-xl font-bold text-ember-100 mb-2">
                  {resolvedScenes.length > 0 ? 'Scene Complete!' : 'No Active Scene'}
                </h2>
                <p className="text-ember-300/60 mb-6">
                  {resolvedScenes.length > 0 ? (
                    <>The adventure continues... What happens next?</>
                  ) : (
                    <>{isAdmin ? 'Start a new scene to begin the adventure' : 'Waiting for the GM to start a scene'}</>
                  )}
                </p>
              </div>

              {/* Show story context if there are resolved scenes */}
              {resolvedScenes.length > 0 && (
                <div className="max-w-2xl mx-auto mb-8">
                  <div className="bg-black/25 rounded-lg p-4 border border-ember-900/30">
                    <div className="flex items-start gap-3 mb-3">
                      <span className="text-2xl">📖</span>
                      <div className="flex-1">
                        <h3 className="font-bold text-ember-100 mb-1">Last Scene Summary</h3>
                        <p className="text-sm text-ember-300/60 line-clamp-3">
                          {resolvedScenes[0].sceneResolutionText
                            ? resolvedScenes[0].sceneResolutionText.slice(0, 200) + '...'
                            : 'Scene resolved'}
                        </p>
                      </div>
                    </div>
                    <Link
                      href={`/campaigns/${campaignId}/story-log`}
                      className="text-xs text-ember-300 hover:text-ember-200 transition-colors"
                    >
                      View complete story log →
                    </Link>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              {isAdmin && (
                <div className="max-w-2xl mx-auto space-y-4">
                  {!showSceneOptions ? (
                    <>
                      <button
                        onClick={handleContinueStory}
                        disabled={startingScene}
                        className="px-4 py-2.5 rounded-lg bg-gradient-to-b from-wine-500 to-wine-700 hover:from-wine-400 hover:to-wine-600 text-ember-100 font-medium border border-ember-900/50 shadow-lg shadow-black/40 transition-all text-center w-full disabled:opacity-50 text-lg py-4"
                      >
                        {startingScene ? (
                          <span className="flex items-center justify-center gap-2">
                            <div className="spinner h-5 w-5"></div>
                            Generating scene...
                          </span>
                        ) : (
                          <span className="flex items-center justify-center gap-2">
                            🎬 {resolvedScenes.length > 0 ? 'Continue Story' : 'Start First Scene'}
                          </span>
                        )}
                      </button>

                      {resolvedScenes.length > 0 && campaign?.characters?.length > 0 && (
                        <button
                          onClick={() => setShowSceneOptions(true)}
                          className="w-full text-sm text-ember-300 hover:text-ember-200 transition-colors py-2"
                        >
                          ⚙️ More scene options...
                        </button>
                      )}

                      {resolvedScenes.length > 0 && (
                        <p className="text-xs text-ember-400/50 text-center">
                          The AI will generate a scene that continues naturally from where you left off
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="bg-black/25 rounded-lg border border-ember-900/30 p-6 space-y-4">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-ember-100 text-lg">Scene Creation Options</h3>
                        <button
                          onClick={() => {
                            setShowSceneOptions(false)
                            setSelectedSceneCharacters([])
                          }}
                          className="text-ember-300/60 hover:text-ember-100"
                        >
                          ✕
                        </button>
                      </div>

                      {/* Option 1: Continue Story */}
                      <div className="space-y-2">
                        <button
                          onClick={handleContinueStory}
                          disabled={startingScene}
                          className="px-4 py-2.5 rounded-lg bg-gradient-to-b from-wine-500 to-wine-700 hover:from-wine-400 hover:to-wine-600 text-ember-100 font-medium border border-ember-900/50 shadow-lg shadow-black/40 transition-all text-center w-full disabled:opacity-50"
                        >
                          {startingScene ? 'Generating...' : '📖 Continue Story Naturally'}
                        </button>
                        <p className="text-xs text-ember-400/50">
                          AI chooses the next scene based on story flow and character goals
                        </p>
                      </div>

                      <div className="border-t border-ember-900/30 my-4"></div>

                      {/* Option 2: Full Party Scene */}
                      {campaign?.characters?.length > 1 && (
                        <>
                          <div className="space-y-2">
                            <button
                              onClick={handleFullPartyScene}
                              disabled={startingScene}
                              className="px-4 py-2.5 rounded-lg bg-black/30 hover:bg-black/40 border border-ember-900/40 text-ember-300 font-medium transition-colors text-center w-full disabled:opacity-50"
                            >
                              {startingScene ? 'Generating...' : '👥 Full Party Scene'}
                            </button>
                            <p className="text-xs text-ember-400/50">
                              Create a scene with all {campaign.characters.length} characters
                            </p>
                          </div>

                          <div className="border-t border-ember-900/30 my-4"></div>
                        </>
                      )}

                      {/* Option 3: Character-Focused Scene */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="font-bold text-ember-100 text-sm">
                            🎭 Character-Focused Scene
                          </label>
                          <span className="text-xs text-ember-400/50">
                            {selectedSceneCharacters.length} selected
                          </span>
                        </div>

                        <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto">
                          {campaign?.characters?.map((character: any) => (
                            <label
                              key={character.id}
                              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                                selectedSceneCharacters.includes(character.id)
                                  ? 'bg-wine-800/20 border-wine-600/40'
                                  : 'bg-black/20 border-ember-900/30 hover:border-ember-700/40'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedSceneCharacters.includes(character.id)}
                                onChange={() => toggleCharacterSelection(character.id)}
                                className="w-4 h-4 accent-wine-500"
                              />
                              <div className="flex-1">
                                <div className="font-medium text-ember-100">{character.name}</div>
                                <div className="text-xs text-ember-300/60 truncate">
                                  {character.concept || character.description}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>

                        <button
                          onClick={handleCharacterFocusedScene}
                          disabled={startingScene || selectedSceneCharacters.length === 0}
                          className="px-4 py-2.5 rounded-lg bg-black/30 hover:bg-black/40 border border-ember-900/40 text-ember-300 font-medium transition-colors text-center w-full disabled:opacity-50"
                        >
                          {startingScene
                            ? 'Generating...'
                            : `Create Scene with ${selectedSceneCharacters.length || 0} Character${selectedSceneCharacters.length !== 1 ? 's' : ''}`}
                        </button>
                        <p className="text-xs text-ember-400/50">
                          AI will create a scene focused on the selected character{selectedSceneCharacters.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!isAdmin && (
                <p className="text-center text-ember-400/50 text-sm">
                  Waiting for the GM to start the next scene...
                </p>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Character Selector */}
          {userCharacters.length > 0 && (
            <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
              <h3 className="text-sm font-bold text-ember-300/60 mb-3">SELECT CHARACTER</h3>
              <select
                value={selectedCharacterId}
                onChange={(e) => setSelectedCharacterId(e.target.value)}
                className="px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 w-full"
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
                      <h4 className="font-bold text-ember-100 text-lg">{selectedCharacter.name}</h4>
                      <p className="text-sm text-ember-300/60">{selectedCharacter.concept}</p>
                    </div>
                    <button
                      onClick={() => setShowCharacterSnapshot(true)}
                      className="px-2 py-1 bg-wine-600 hover:bg-wine-500 text-ember-100 rounded text-xs font-medium transition-colors"
                      title="Quick Reference"
                    >
                      👁️ View
                    </button>
                  </div>
                  {selectedCharacter.currentLocation && (
                    <p className="text-xs text-ember-400/50">
                      📍 {selectedCharacter.currentLocation}
                    </p>
                  )}
                  {Array.isArray(selectedCharacter.conditions) &&
                    selectedCharacter.conditions.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs text-ember-400/50 mb-1">Conditions:</p>
                        <div className="flex flex-wrap gap-1">
                          {selectedCharacter.conditions.map((cond: string, i: number) => (
                            <span
                              key={i}
                              className="px-2 py-1 bg-wine-800/30 text-wine-400 rounded text-xs"
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
            <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-ember-300/60">MAP</h3>
                <button
                  onClick={() => setShowMap(!showMap)}
                  className="text-xs text-ember-400/50 hover:text-ember-100 transition-colors"
                >
                  {showMap ? 'Hide' : 'Show'}
                </button>
              </div>
              {showMap && (
                <div className="rounded-lg overflow-hidden border border-ember-900/30">
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
            <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-0">
              <ChatPanel
                campaignId={campaignId}
                currentUserId={user.id}
                currentUserName={user.name || user.email}
                userCharacters={userCharacters}
                sceneId={currentScene.id}
                icOnly={true}
              />
            </div>
          )}

          {/* Active Clocks */}
          {campaign?.campaign?.clocks && campaign.campaign.clocks.length > 0 && (
            <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
              <h3 className="text-sm font-bold text-ember-300/60 mb-3">ACTIVE CLOCKS</h3>
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
              <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-0">
                <CompactTimeline events={campaign.campaign.timeline.slice(0, 5)} />
              </div>
            )}
        </div>
      </div>
      </main>

      <TavernNav campaignId={campaignId} />

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

      {/* Insufficient Funds Modal */}
      {showInsufficientFunds && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/70 z-50"
            onClick={() => setShowInsufficientFunds(false)}
          />

          {/* Modal */}
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg">
            <div className="bg-gradient-to-br from-tavern-800 to-tavern-900 border border-wine-600/40 rounded-2xl shadow-2xl shadow-black/50 p-6 animate-scale-in">
              <div className="flex items-start gap-4 mb-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-wine-800/30 flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-wine-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-ember-100 mb-2">Insufficient Funds</h3>
                  <p className="text-ember-200/80 text-sm leading-relaxed">
                    {insufficientFundsDetails}
                  </p>
                </div>
              </div>

              <div className="bg-black/25 border border-ember-900/40 rounded-lg p-4 mb-6">
                <p className="text-xs font-semibold text-ember-300/60 mb-2">Pricing Structure:</p>
                <div className="text-xs text-ember-300/60 space-y-1">
                  <p>• Solo play (1 player): $0.25 per scene</p>
                  <p>• Small group (2-4 players): $0.50 per scene</p>
                  <p>• Large group (5-6 players): $0.75 per scene</p>
                </div>
              </div>

              {addFundsError && (
                <div className="mb-4 p-3 bg-wine-800/20 border border-wine-600/40 rounded-lg">
                  <p className="text-sm text-wine-400">{addFundsError}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleAddFundsFromModal}
                  disabled={addFundsLoading}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-ember-600 to-ember-500 hover:from-ember-500 hover:to-ember-400 text-ember-100 font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {addFundsLoading ? 'Redirecting...' : 'Add Funds ($1.00)'}
                </button>
                <button
                  onClick={() => { setShowInsufficientFunds(false); setAddFundsError('') }}
                  disabled={addFundsLoading}
                  className="px-4 py-2.5 bg-black/25 hover:bg-black/30 text-ember-200/80 font-medium rounded-lg transition-all duration-200"
                >
                  Cancel
                </button>
              </div>

              <p className="text-xs text-ember-400/50 mt-4 text-center">
                You will be redirected to Stripe to complete your payment securely.
              </p>
            </div>
          </div>
        </>
      )}
    </TavernPage>
  )
}
