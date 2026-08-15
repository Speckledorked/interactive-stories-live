// src/app/campaigns/[id]/story/page.tsx
// Main story view - where the game happens!

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { authenticatedFetch, isAuthenticated, getUser, setLastCampaignId } from '@/lib/clientAuth'
import { pusherClient } from '@/lib/pusher'
import { pluralize, truncateWithEllipsis } from '@/lib/format'
import type { MapData } from '@/lib/maps/map-service'
import AILoadingState from '@/components/scene/AILoadingState'
import SceneMoodTag, { detectSceneMood } from '@/components/scene/SceneMoodTag'
import AITransparencyPanel, { type WorldStateChange } from '@/components/scene/AITransparencyPanel'
import { extractWorldStateChanges, extractOutcomeAdherence, extractMoveVariety } from '@/lib/game/worldStateChanges'
import type { AdherenceResult } from '@/lib/game/outcomeAdherence'
import type { MoveVarietyResult } from '@/lib/game/moveVariety'
import CharacterSnapshotModal from '@/components/character/CharacterSnapshotModal'
import { useCommandPalette } from '@/contexts/CommandPaletteContext'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import KeyboardShortcutsModal from '@/components/KeyboardShortcutsModal'
import SimpleXCard from '@/components/safety/SimpleXCard'
import ReportContentModal from '@/components/safety/ReportContentModal'
import { CharacterSelectorPanel } from '@/components/scene/CharacterSelectorPanel'
import { TurnOrderPanel } from '@/components/scene/TurnOrderPanel'
import { MapViewerPanel } from '@/components/scene/MapViewerPanel'
import { SceneChatPanel } from '@/components/scene/SceneChatPanel'
import { ActiveClocksPanel } from '@/components/scene/ActiveClocksPanel'
import { RecentTimelinePanel } from '@/components/scene/RecentTimelinePanel'
import { Home, Scroll, StickyNote, Map as MapIcon, MessageSquare, Settings as SettingsIcon, Keyboard } from 'lucide-react'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { SubNavTabs } from '@/components/ui/SubNavTabs'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { IconButton } from '@/components/ui/icon-button'

// Whether `characterId` may act in `scene` — participants is null for a
// genuinely open scene (anyone can act; membership grows dynamically as
// people do, see scene/route.ts). scoped: true means the GM scoped this
// scene to specific characters at creation (a Character-Focused scene, or
// one half of a split party) — see start-scene/route.ts. Gating on
// `characterIds.length === 0` alone used to misfire here: an open scene's
// participants also becomes a non-empty {characterIds, userIds} object
// the instant its first player acts, which made this return false for
// every OTHER character from then on — they'd see "No Active Scene" and
// start a brand-new one instead of joining the existing one, splitting
// the party into two disconnected stories.
//
// `allActiveScenes` closes a real gap: a split-party/Character-Focused
// scene can be created for a character before that character has ever
// acted in a still-open scene (the open scene's participants stay null
// until someone submits, so the start-scene overlap check sees nothing to
// conflict with). Once that happens, the character is scoped into the new
// scene AND still shown as eligible for the open one — this mirrors
// scene/route.ts's actual submission-time "already in another active
// scene" rejection so the UI doesn't offer an action box that would just
// 400 on submit.
function canParticipateInScene(scene: any, characterId: string, allActiveScenes: any[] = []): boolean {
  const participants = scene.participants as any
  if (!participants?.scoped) {
    const committedElsewhere = allActiveScenes.some(other =>
      other.id !== scene.id &&
      (other.participants as any)?.scoped &&
      ((other.participants as any).characterIds || []).includes(characterId)
    )
    return !committedElsewhere
  }
  return (participants.characterIds || []).includes(characterId)
}

// Tab label for a concurrent scene — the characters actually in it reads
// better than a bare scene number when the party's split across several
// scenes at once. Falls back to the scene number for an open scene with
// no recorded participants yet (nobody's acted in it).
function sceneTabLabel(scene: any, characters: any[]): string {
  const characterIds = (scene.participants as any)?.characterIds as string[] | undefined
  if (characterIds && characterIds.length > 0) {
    const names = characterIds
      .map(id => characters.find((c: any) => c.id === id)?.name)
      .filter(Boolean)
    if (names.length > 0) return names.join(', ')
  }
  return `Scene ${scene.sceneNumber}`
}

export default function StoryPage() {
  const router = useRouter()
  const params = useParams()
  const campaignId = params.id as string

  const [campaign, setCampaign] = useState<any>(null)
  const [activeScenes, setActiveScenes] = useState<any[]>([])
  const [resolvedScenes, setResolvedScenes] = useState<any[]>([])
  const [userCharacters, setUserCharacters] = useState<any[]>([])
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('')
  const [actionText, setActionText] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({})
  // Ask-the-GM: an out-of-character clarifying question, deliberately
  // separate from the action form's state — asking a question shouldn't be
  // blocked by having already submitted your real action for this exchange.
  const [askGmText, setAskGmText] = useState<Record<string, string>>({})
  const [askingGm, setAskingGm] = useState<Record<string, boolean>>({})
  const [askGmError, setAskGmError] = useState<Record<string, string>>({})
  const [showAskGm, setShowAskGm] = useState<Record<string, boolean>>({})
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [expandedActions, setExpandedActions] = useState<Record<string, boolean>>({})
  // Per-scene, per-exchange collapse overrides for a scene's resolution
  // history. Absent = default (only the most recent exchange starts
  // expanded) — see isExchangeExpanded below. Keeping this as sparse
  // overrides rather than a full map means a brand-new exchange always
  // defaults correctly without this state needing to be seeded anywhere.
  const [expandedExchanges, setExpandedExchanges] = useState<Record<string, Record<number, boolean>>>({})
  const [activeMap, setActiveMap] = useState<MapData | null>(null)
  const [showCharacterSnapshot, setShowCharacterSnapshot] = useState(false)
  const [sceneWorldStateChanges, setSceneWorldStateChanges] = useState<Record<string, WorldStateChange[]>>({})
  // #96: scene illustration. Populated two ways: on load, from each
  // scene's sceneImage field (attached by GET /scene, since SceneImage
  // has no Prisma relation to ride an `include` on); live, from the
  // scene:image-ready Pusher event below for a generation kicked off
  // while the page is open.
  const [sceneImageUrls, setSceneImageUrls] = useState<Record<string, string>>({})
  // Admin-only manual backfill (generate-image route) for a scene that
  // never got — or failed to get — its automatic first-exchange image,
  // e.g. one already open when sceneImageGenerationEnabled was turned on.
  const [generatingImageFor, setGeneratingImageFor] = useState<Record<string, boolean>>({})
  const [imageGenError, setImageGenError] = useState<Record<string, string>>({})
  const [sceneOutcomeAdherence, setSceneOutcomeAdherence] = useState<Record<string, AdherenceResult>>({})
  const [sceneMoveVariety, setSceneMoveVariety] = useState<Record<string, MoveVarietyResult>>({})
  const [expandedTransparency, setExpandedTransparency] = useState<Record<string, boolean>>({})
  const [startingScene, setStartingScene] = useState(false)
  const [endingScene, setEndingScene] = useState(false)
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<string | null>(null)
  const [deletingSceneId, setDeletingSceneId] = useState<string | null>(null)
  // Which of several genuinely concurrent scenes (a split party) the
  // viewer is currently looking at. Falls back to the first available
  // scene below rather than needing to be kept in sync on every
  // load/resolve/end — a stale id from a scene that just resolved or
  // ended simply stops matching and the fallback takes over.
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null)
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)
  // Turn order — an opt-in, advisory queue layered on top of the scene's
  // real (simultaneous) action collection; see TurnTracker's doc comment.
  // null = no turn tracker exists for this scene (the default/only state
  // until a player enables one).
  const [sceneTurnInfo, setSceneTurnInfo] = useState<any>(null)
  const [enablingTurnOrder, setEnablingTurnOrder] = useState(false)
  const [endingTurnOrder, setEndingTurnOrder] = useState(false)
  const [showSceneOptions, setShowSceneOptions] = useState(false)
  const [selectedSceneCharacters, setSelectedSceneCharacters] = useState<string[]>([])
  const [showInsufficientFunds, setShowInsufficientFunds] = useState(false)
  const [insufficientFundsDetails, setInsufficientFundsDetails] = useState('')
  const [addFundsLoading, setAddFundsLoading] = useState(false)
  const [addFundsError, setAddFundsError] = useState('')
  const [resolvingMessage, setResolvingMessage] = useState('')

  const user = getUser()
  const isAdmin = campaign?.userRole === 'ADMIN'

  // The scene(s) the viewer's selected character can actually act in.
  // Picking activeScenes[0] unconditionally (the old behavior) broke down
  // the moment more than one scene could be active at once (a split
  // party): a player would see chat/turn-order/map for whichever scene
  // happened to be created first, not the one their own character is in.
  const availableScenes = useMemo(
    () => activeScenes.filter(scene => selectedCharacterId && canParticipateInScene(scene, selectedCharacterId, activeScenes)),
    [activeScenes, selectedCharacterId]
  )
  // The scene the viewer is actively looking at — the tab they picked,
  // when they've genuinely got more than one concurrent scene available,
  // otherwise just the one they've got.
  const currentScene = availableScenes.find(s => s.id === activeSceneId) ?? availableScenes[0] ?? null

  // Split-party detection: living characters not already tied up in an
  // active scene, grouped by currentLocation. A character with no
  // location set is excluded from auto-grouping entirely — there's
  // nothing to cluster them by, so they're left for the table to place
  // manually via the existing Character-Focused option. 2+ groups means
  // the party is genuinely split; the location engine never routes this
  // automatically (see help copy) — a player has to explicitly choose it.
  const locationGroups = useMemo(() => {
    const busyIds = new Set(
      activeScenes.flatMap(scene => (scene.participants as any)?.characterIds || [])
    )
    // Grouped by the stable locationId when a character has one resolved,
    // falling back to the trimmed currentLocation string otherwise — two
    // characters whose location text merely differs in casing/wording
    // ("the Docks" vs "The Docks District") but share the same resolved
    // Location row are still recognized as being in the same place. See
    // README Known Bugs P1 — Location stored as free text, not an FK.
    const groups = new Map<string, { label: string; characters: any[] }>()
    for (const c of campaign?.characters || []) {
      if (c.isAlive === false || busyIds.has(c.id)) continue
      const loc = (c.currentLocation || '').trim()
      if (!loc) continue
      const key = c.locationId || loc
      if (!groups.has(key)) groups.set(key, { label: loc, characters: [] })
      groups.get(key)!.characters.push(c)
    }
    return groups
  }, [activeScenes, campaign])

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
      setActiveScenes(sceneData.scenes || [])
      const loadedImages: Record<string, string> = {}
      for (const s of sceneData.scenes || []) {
        if (s.sceneImage?.status === 'COMPLETED' && s.sceneImage?.imageUrl) {
          loadedImages[s.id] = s.sceneImage.imageUrl
        }
      }
      if (Object.keys(loadedImages).length > 0) {
        setSceneImageUrls(prev => ({ ...loadedImages, ...prev }))
      }

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
      const adherenceMap: Record<string, AdherenceResult> = {}
      const moveVarietyMap: Record<string, MoveVarietyResult> = {}
      for (const scene of sceneData.scenes || []) {
        // Shape lives in one place (world-state-tracker) rather than being
        // hand-read out of an untyped Json blob here.
        const sceneChanges = extractWorldStateChanges(scene.consequences)
        if (sceneChanges.length > 0) {
          changesMap[scene.id] = sceneChanges
        }
        const adherence = extractOutcomeAdherence(scene.consequences)
        if (adherence) {
          adherenceMap[scene.id] = adherence
        }
        const moveVariety = extractMoveVariety(scene.consequences)
        if (moveVariety) {
          moveVarietyMap[scene.id] = moveVariety
        }
      }
      setSceneWorldStateChanges(changesMap)
      setSceneOutcomeAdherence(adherenceMap)
      setSceneMoveVariety(moveVarietyMap)

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

  const loadTurnInfo = async (sceneId: string) => {
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/turns?sceneId=${sceneId}`)
      if (response.ok) {
        const json = await response.json()
        setSceneTurnInfo(json.turnInfo)
      }
    } catch {
      // Non-critical — the "Enable turn order" prompt just won't reflect
      // an already-active tracker until the next Pusher update or reload.
    }
  }

  useEffect(() => {
    if (currentScene?.id) {
      loadTurnInfo(currentScene.id)
    } else {
      setSceneTurnInfo(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentScene?.id])

  const handleEnableTurnOrder = async () => {
    if (!currentScene?.id) return
    setEnablingTurnOrder(true)
    try {
      const participants = (campaign?.campaign?.characters || [])
        .filter((c: any) => c.isAlive !== false)
        .map((c: any) => ({ userId: c.userId, characterId: c.id, name: c.name }))

      if (participants.length === 0) {
        setError('No characters to put in turn order yet.')
        return
      }

      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/turns`, {
        method: 'POST',
        body: JSON.stringify({ action: 'initialize', sceneId: currentScene.id, participants }),
      })

      if (response.ok) {
        await loadTurnInfo(currentScene.id)
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to enable turn order')
      }
    } catch {
      setError('Failed to enable turn order')
    } finally {
      setEnablingTurnOrder(false)
    }
  }

  const handleEndTurnOrder = async () => {
    if (!currentScene?.id) return
    setEndingTurnOrder(true)
    try {
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/turns?sceneId=${currentScene.id}`,
        { method: 'DELETE' }
      )
      if (response.ok) {
        setSceneTurnInfo(null)
      }
    } finally {
      setEndingTurnOrder(false)
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

    // Listen for ask-the-GM clarifications — shared with the whole party,
    // the same "said out loud at the table" visibility a real question has.
    channel.bind('gm:clarification', (data: any) => {
      console.log('GM clarification:', data)
      loadData()
    })

    // Turn order updates — null means a player just ended tracking for the
    // scene (hides the widget); otherwise the fresh turn state for
    // whichever scene is active. Also drives whether the "Enable turn
    // order" prompt shows at all, so every connected client agrees on
    // whether tracking is on for this scene without a page reload.
    channel.bind('turn-update', (data: any) => {
      setSceneTurnInfo(data)
    })

    // Listen for scene resolution starting
    channel.bind('scene:resolving', (data: any) => {
      console.log('Scene resolving:', data)
      setResolvingMessage(data.message || 'MythOS is processing your actions...')
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
        ? `MythOS took too long to respond. This can happen during high load. The scene is ready to try again.`
        : `Scene resolution encountered an issue: ${data.error}. The scene is ready to try again.`
      setError(message)
      loadData()
    })

    // Listen for a completed scene illustration (#96) — arrives well after
    // scene:resolved since it runs in its own worker invocation; patches
    // the image in directly rather than a full loadData() refetch, since
    // this is the one piece of scene state this page doesn't otherwise
    // reload for.
    channel.bind('scene:image-ready', (data: any) => {
      console.log('Scene image ready:', data)
      if (data.sceneId && data.imageUrl) {
        setSceneImageUrls(prev => ({ ...prev, [data.sceneId]: data.imageUrl }))
        setGeneratingImageFor(prev => (prev[data.sceneId] ? { ...prev, [data.sceneId]: false } : prev))
      }
    })

    // Listen for scene resets
    channel.bind('scene:reset', (data: any) => {
      console.log('Scene reset:', data)
      loadData()
    })

    // Listen for a regenerated scene intro
    channel.bind('scene:regenerated', (data: any) => {
      console.log('Scene intro regenerated:', data)
      loadData()
    })

    // Listen for a deleted scene
    channel.bind('scene:deleted', (data: any) => {
      console.log('Scene deleted:', data)
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

    // Listen for map updates (#291: map generation is now an async job —
    // the completion event carries only a mapId, same minimal-payload
    // convention scene:image-ready uses, so the client refetches the full
    // map rather than expecting the broadcast to carry it).
    channel.bind('map:ready', async (data: any) => {
      console.log('Map generated:', data)
      try {
        const mapResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/maps/active`)
        if (mapResponse.ok) {
          const mapData = await mapResponse.json()
          setActiveMap(mapData.map)
        }
      } catch (mapErr) {
        console.error('Failed to refresh map after generation:', mapErr)
      }
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

    // Safety pause (X-Card). The safety service has always published these
    // and nothing has ever listened, so hitting the X-Card stopped the
    // scene on the server while every other player's screen carried on as
    // though nothing had happened — they kept writing into a scene that
    // could no longer accept anything, and found out only when submission
    // failed. Of everything on this channel, this is the event that most
    // needs to land immediately.
    channel.bind('scene:paused', (data: any) => {
      console.log('Scene paused for a safety check-in:', data)
      setResolvingMessage('')
      setError('')
      loadData()
    })

    channel.bind('scene:resumed', (data: any) => {
      console.log('Scene resumed:', data)
      setError('')
      loadData()
    })

    // Scene ended by the GM — also published and never listened for, so
    // the table sat on a finished scene until someone reloaded.
    channel.bind('scene:ended', (data: any) => {
      console.log('Scene ended:', data)
      setResolvingMessage('')
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
      // Force-resolve is a host-only rescue tool; normal resolution
      // fires automatically once everyone has acted.
      if (currentScene && isAdmin) handleResolveScene(currentScene.id)
    },
    onEndScene: () => {
      // Any player — story pacing belongs to the table, not a human GM.
      if (currentScene) handleEndScene(currentScene.id)
    },
    onStartScene: () => {
      handleStartNewScene()
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

      setSuccess('✓ Action submitted! The scene will auto-resolve once everyone has acted.')
      setActionText(prev => ({ ...prev, [sceneId]: '' }))
      await loadData() // Reload to show new action
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit action')
    } finally {
      setSubmitting(prev => ({ ...prev, [sceneId]: false }))
    }
  }

  // Ask-the-GM: an out-of-character clarifying question. Deliberately a
  // separate endpoint from handleSubmitAction — this never creates a
  // PlayerAction, never rolls dice, never counts toward the exchange.
  const handleAskGm = async (e: React.FormEvent, sceneId: string) => {
    e.preventDefault()
    const question = askGmText[sceneId]?.trim()
    if (!question || !selectedCharacterId) return

    setAskingGm(prev => ({ ...prev, [sceneId]: true }))
    setAskGmError(prev => ({ ...prev, [sceneId]: '' }))

    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/scene/ask-gm`, {
        method: 'POST',
        body: JSON.stringify({ sceneId, characterId: selectedCharacterId, question })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to ask the GM')
      }

      setAskGmText(prev => ({ ...prev, [sceneId]: '' }))
      await loadData() // Reload to show the new clarification
    } catch (err) {
      setAskGmError(prev => ({ ...prev, [sceneId]: err instanceof Error ? err.message : 'Failed to ask the GM' }))
    } finally {
      setAskingGm(prev => ({ ...prev, [sceneId]: false }))
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

      setSuccess('Resolution started — MythOS is writing. Results will appear here shortly.')
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

  // One scene per location group — each group is disjoint by construction
  // (locationGroups already excludes anyone already in an active scene),
  // so these calls never conflict with each other or with start-scene's
  // own overlap check.
  const handleStartSplitPartyScenes = async () => {
    setError('')
    setSuccess('')
    setStartingScene(true)
    try {
      for (const { characters } of locationGroups.values()) {
        const response = await authenticatedFetch(
          `/api/campaigns/${campaignId}/start-scene`,
          {
            method: 'POST',
            body: JSON.stringify({ characterIds: characters.map((c: any) => c.id) })
          }
        )
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to start a split scene')
        }
      }
      setSuccess(`Started ${locationGroups.size} scenes, one per location.`)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start split scenes')
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
        if (response.status === 402) {
          // Billing happens once, right here, when the scene actually
          // ends — not on the actions along the way.
          setInsufficientFundsDetails(data.details || 'You need to add funds to end this scene.')
          setShowInsufficientFunds(true)
          return
        }
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

  // Admin-only manual backfill for a scene that never got — or failed to
  // get — its automatic first-exchange image (e.g. one already open when
  // sceneImageGenerationEnabled was turned on). Relies on the existing
  // scene:image-ready Pusher listener to pick up a success; on a server-
  // side failure there is no equivalent push event, so a bounded timeout
  // clears the "Generating…" state instead of hanging forever — the same
  // stuck-button bug already found and fixed once this session for the
  // campaign hero image, not worth reintroducing here.
  const handleGenerateSceneImage = async (sceneId: string) => {
    setImageGenError(prev => ({ ...prev, [sceneId]: '' }))
    setGeneratingImageFor(prev => ({ ...prev, [sceneId]: true }))
    try {
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/scenes/${sceneId}/generate-image`,
        { method: 'POST' }
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to start scene image generation')
      }
      setTimeout(() => {
        setGeneratingImageFor(prev => {
          if (!prev[sceneId]) return prev
          setImageGenError(errPrev => ({ ...errPrev, [sceneId]: 'Still processing — refresh in a bit to check.' }))
          return { ...prev, [sceneId]: false }
        })
      }, 60000)
    } catch (err) {
      setImageGenError(prev => ({ ...prev, [sceneId]: err instanceof Error ? err.message : 'Failed to start scene image generation' }))
      setGeneratingImageFor(prev => ({ ...prev, [sceneId]: false }))
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

  const handleRegenerateScene = async (sceneId: string) => {
    if (!confirm('Regenerate this scene\'s opening? This replaces the current text — only available before anyone has acted.')) {
      return
    }

    setError('')
    setSuccess('')
    setRegeneratingSceneId(sceneId)

    try {
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/scenes/${sceneId}/regenerate-intro`,
        { method: 'POST' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to regenerate scene')
      }

      setSuccess('Scene regenerated.')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate scene')
    } finally {
      setRegeneratingSceneId(null)
    }
  }

  const handleDeleteScene = async (sceneId: string) => {
    if (!confirm('Permanently delete this scene? This cannot be undone. Anything that already happened in it (stat changes, world effects, log entries) stays in the campaign — only the scene itself goes away.')) {
      return
    }

    setError('')
    setSuccess('')
    setDeletingSceneId(sceneId)

    try {
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/scenes/${sceneId}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete scene')
      }

      setSuccess('Scene deleted.')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete scene')
    } finally {
      setDeletingSceneId(null)
    }
  }

  const handleResumeScene = async (sceneId: string) => {
    setError('')
    setSuccess('')

    try {
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/scenes/${sceneId}/resume`,
        { method: 'POST' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to resume scene')
      }

      setSuccess('Scene resumed.')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume scene')
    }
  }

  if (loading) {
    return (
      <TavernPage background="myth">
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Loading…" campaignId={campaignId} variant="myth" />
        <main className="max-w-7xl mx-auto px-4 pt-28 pb-16 flex justify-center items-center min-h-[60vh]">
          <AILoadingState type="scene" />
        </main>
      </TavernPage>
    )
  }

  const selectedCharacter = userCharacters.find(c => c.id === selectedCharacterId)

  // Helper to check if user has already submitted action in the current exchange
  const hasUserSubmitted = (scene: any) => {
    // currentExchange is 0 on a scene's first-ever exchange — `|| 1` here
    // would coerce that real 0 into 1 and could wrongly match a stale
    // action, permanently showing "already submitted" (see the matching
    // fix in exchange-manager.ts).
    const currentExchange = scene.currentExchange ?? 0
    return scene.playerActions?.some((action: any) =>
      action.userId === user?.id &&
      action.characterId === selectedCharacterId &&
      action.exchangeNumber === currentExchange
    )
  }

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
    <TavernPage background="myth">
      <TavernHeader
        backHref={`/campaigns/${campaignId}`}
        title={campaign?.campaign?.name || 'Story'}
        campaignId={campaignId}
        isAdmin={isAdmin}
        variant="myth"
        subrow={
          <div className="max-w-7xl mx-auto px-4 flex items-center justify-between gap-3 border-t border-myth-border pt-2 pb-0">
            <nav className="flex items-center gap-1 overflow-x-auto text-sm">
              <SubNavTabs tabs={storyTabs} activeKey="story" itemClassName="whitespace-nowrap flex-shrink-0" variant="myth" />
            </nav>
            <div className="flex items-center gap-1 flex-shrink-0 pb-1.5">
              <SimpleXCard campaignId={campaignId} sceneId={currentScene?.id} />
              <ReportContentModal campaignId={campaignId} />
              <IconButton
                icon={Keyboard}
                label="Keyboard shortcuts"
                size="sm"
                onClick={() => setShowKeyboardShortcuts(true)}
              />
            </div>
          </div>
        }
      />

      <main className="max-w-7xl mx-auto px-3 sm:px-4 pt-28 pb-28">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6">
        {/* Main Story Column */}
        <div className="lg:col-span-3 space-y-4 lg:space-y-6">
          {/* Status Messages */}
          {error && (
            <div className="bg-myth-danger/10 border border-myth-danger/30 text-myth-danger px-4 py-3 rounded-lg">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-myth-good/10 border border-myth-good/30 text-myth-good px-4 py-3 rounded-lg">
              {success}
            </div>
          )}
          {resolvingMessage && (
            <div className="bg-myth-info/10 border border-myth-info/30 text-myth-info px-4 py-3 rounded-lg flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-myth-info/40"></div>
              <span>{resolvingMessage}</span>
            </div>
          )}

          {/* Split party — shown to every player (there is no human GM;
              anyone can start scenes), independent of whichever character
              is selected: the party can be split even when the viewer's
              own character already has a scene to look at. */}
          {locationGroups.size >= 2 && (
            <div className="rounded-lg border border-myth-warn/30 bg-myth-warn/10 p-5">
              <h3 className="font-display text-myth-ink mb-1">Your party is split</h3>
              <p className="text-sm text-myth-ink-muted mb-3">
                {Array.from(locationGroups.values())
                  .map(({ label, characters }) => `${characters.map((c: any) => c.name).join(', ')} at ${label}`)
                  .join(' · ')}
              </p>
              <Button
                variant="secondary"
                onClick={handleStartSplitPartyScenes}
                disabled={startingScene}
              >
                {startingScene ? 'Starting…' : `Start ${locationGroups.size} scenes, one per location`}
              </Button>
            </div>
          )}

          {/* Scene switcher — genuinely concurrent scenes (a split party)
              get tabs instead of being stacked one after another in the
              same scroll; picking one scopes the action box, chat, map,
              and turn tracker below to just that scene. */}
          {availableScenes.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {availableScenes.map(scene => (
                <button
                  key={scene.id}
                  onClick={() => setActiveSceneId(scene.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    currentScene?.id === scene.id
                      ? 'bg-myth-accent/10 border-myth-accent text-myth-ink'
                      : 'bg-myth-surface-sunken border-myth-border text-myth-ink-faint hover:text-myth-ink-muted'
                  }`}
                >
                  {sceneTabLabel(scene, campaign?.characters || [])}
                </button>
              ))}
            </div>
          )}

          {/* Active Scenes */}
          {availableScenes.length > 0 ? (
            (availableScenes.length > 1 && currentScene ? [currentScene] : availableScenes).map(scene => {
              const userHasSubmitted = hasUserSubmitted(scene)
              const waitingOn = (scene.waitingOnUsers as any) || []
              const isWaitingOnUser = waitingOn.includes(user?.id)
              const currentStageText = getCurrentStageText(scene)

              return (
                <div key={scene.id} className="space-y-4">
                  <div className="rounded-lg border border-myth-border/60 bg-myth-surface/40 p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <h2 className="font-display text-xl font-semibold text-myth-ink">
                          Scene {scene.sceneNumber}
                        </h2>
                        {campaign?.worldMeta?.currentInGameDate && (
                          <span className="font-mono text-xs text-myth-ink-faint">
                            {campaign.worldMeta.currentInGameDate}
                          </span>
                        )}
                        {/* Scene mood indicators */}
                        <div className="flex gap-2">
                          {detectSceneMood(currentStageText).map((mood, idx) => (
                            <SceneMoodTag key={idx} mood={mood} />
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {scene.isPaused && (
                          <span className="px-3 py-1 rounded-full text-xs font-medium bg-myth-danger/10 text-myth-danger">
                            ✋ paused
                          </span>
                        )}
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          scene.status === 'AWAITING_ACTIONS'
                            ? 'bg-myth-good/10 text-myth-good'
                            : scene.status === 'RESOLVING'
                            ? 'bg-myth-info/10 text-myth-info'
                            : 'bg-myth-surface-sunken text-myth-ink-faint'
                        }`}>
                          {scene.status.replace('_', ' ')}
                        </span>
                        {scene.status === 'AWAITING_ACTIONS' && !scene.sceneResolutionText &&
                          (!scene.playerActions || scene.playerActions.length === 0) && (
                          <Button
                            variant="secondary" size="sm"
                            onClick={() => handleRegenerateScene(scene.id)}
                            disabled={regeneratingSceneId === scene.id}
                            title="Regenerate this scene's opening — only available before anyone has acted"
                          >
                            {regeneratingSceneId === scene.id ? 'Regenerating…' : '🔄 Regenerate'}
                          </Button>
                        )}
                        {isAdmin && (
                          <Button
                            variant="danger" size="sm"
                            onClick={() => handleDeleteScene(scene.id)}
                            disabled={deletingSceneId === scene.id}
                            title="Permanently delete this scene"
                          >
                            {deletingSceneId === scene.id ? 'Deleting…' : '🗑️ Delete'}
                          </Button>
                        )}
                        {scene.status === 'RESOLVING' && isAdmin && (
                          <Button
                            variant="danger" size="sm"
                            onClick={() => handleResetScene(scene.id)}
                            title="Reset stuck scene"
                          >
                            Reset
                          </Button>
                        )}
                      </div>
                    </div>

                    {scene.stakes && (
                      <p className="mb-4 text-xs font-medium uppercase tracking-wide text-myth-accent">
                        At stake: <span className="normal-case text-myth-ink-muted">{scene.stakes}</span>
                      </p>
                    )}

                    {scene.isPaused && (
                      <div className="bg-myth-danger/10 border border-myth-danger/30 rounded-lg p-4 mb-4 flex items-center justify-between gap-4">
                        <div>
                          <p className="text-myth-danger font-medium">This scene is paused for a safety check-in.</p>
                          <p className="text-myth-danger/70 text-sm mt-1">
                            {scene.pausedReason || 'A player used the X-Card.'} No new actions can be submitted until the campaign host resumes play.
                          </p>
                        </div>
                        {isAdmin && (
                          <Button
                            variant="danger"
                            onClick={() => handleResumeScene(scene.id)}
                          >
                            Resume Scene
                          </Button>
                        )}
                      </div>
                    )}

                    {scene.status === 'RESOLVING' && (
                      <AILoadingState type="resolution" />
                    )}

                    {/* Show intro text only if no resolutions exist yet */}
                    {!scene.sceneResolutionText && (
                      <p className="max-w-prose whitespace-pre-wrap leading-relaxed text-myth-ink-muted">
                        {currentStageText}
                      </p>
                    )}

                    {/* Show resolutions if any exist */}
                    {scene.sceneResolutionText && (
                      <>
                        {/* #96: scene illustration, when generation is on for this
                            campaign and the worker has finished. Plain <img>, not
                            next/image — matches this app's only other existing
                            image-rendering convention (wiki/page.tsx), since
                            next/image isn't configured for any remote host yet. */}
                        {sceneImageUrls[scene.id] && (
                          <img
                            src={sceneImageUrls[scene.id]}
                            alt={`Illustration for scene ${scene.sceneNumber}`}
                            className="mt-6 w-full max-h-96 object-cover rounded-lg"
                          />
                        )}
                        {/* Admin-only manual backfill for a scene that never got
                            (or failed to get) its automatic first-exchange image —
                            e.g. one already open when the campaign toggle was
                            turned on. Uses the scene's FIRST exchange for the
                            prompt regardless of how far the scene has moved on
                            since (see generate-image/route.ts). */}
                        {isAdmin && campaign?.sceneImageGenerationEnabled && !sceneImageUrls[scene.id] && (
                          <div className="mt-4 flex items-center gap-3">
                            <Button
                              variant="secondary"
                              onClick={() => handleGenerateSceneImage(scene.id)}
                              disabled={generatingImageFor[scene.id]}
                            >
                              {generatingImageFor[scene.id] ? 'Generating…' : '🖼️ Generate scene image'}
                            </Button>
                            {imageGenError[scene.id] && (
                              <span className="text-xs text-myth-danger">{imageGenError[scene.id]}</span>
                            )}
                          </div>
                        )}
                        <div className="mt-6 pt-6 border-t border-myth-border">
                          <h3 className="font-display text-lg font-semibold text-myth-ink mb-3">
                            {scene.sceneResolutionText.includes('---') ? 'Resolutions' : 'Resolution'}
                          </h3>
                          {/* Split multiple resolutions by separator. Only the
                              most recent exchange is expanded by default —
                              earlier ones collapse to a one-line preview so a
                              long-running scene doesn't turn into an endless
                              scroll. Each collapses/reopens independently. */}
                          {(() => {
                            const resolutions = scene.sceneResolutionText!.split('\n\n---\n\n')
                            const lastIdx = resolutions.length - 1
                            const overrides = expandedExchanges[scene.id]
                            return resolutions.map((resolution: string, idx: number) => {
                              const isExpanded = overrides?.[idx] ?? idx === lastIdx
                              return (
                                <div key={idx} className={idx > 0 ? 'mt-4 pt-4 border-t border-myth-border' : ''}>
                                  {resolutions.length > 1 ? (
                                    <button
                                      type="button"
                                      onClick={() => setExpandedExchanges(prev => ({
                                        ...prev,
                                        [scene.id]: { ...prev[scene.id], [idx]: !isExpanded },
                                      }))}
                                      className="w-full flex items-center justify-between text-left mb-2 group"
                                    >
                                      <h4 className="text-sm font-medium text-myth-ink-faint group-hover:text-myth-ink transition-colors">
                                        Exchange {idx + 1}
                                      </h4>
                                      <span className="text-myth-ink-faint text-xs flex-shrink-0 ml-2">
                                        {isExpanded ? '▼' : '▶'}
                                      </span>
                                    </button>
                                  ) : null}
                                  {isExpanded ? (
                                    <p className="max-w-prose whitespace-pre-wrap leading-relaxed text-myth-ink-muted">
                                      {resolution}
                                    </p>
                                  ) : (
                                    <p className="max-w-prose truncate text-sm text-myth-ink-faint italic">
                                      {resolution.trim().slice(0, 140)}{resolution.trim().length > 140 ? '…' : ''}
                                    </p>
                                  )}
                                </div>
                              )
                            })
                          })()}
                        </div>

                        {/* AI Transparency Panel - Show world state changes */}
                        {sceneWorldStateChanges[scene.id] && sceneWorldStateChanges[scene.id].length > 0 && (
                          <div className="mt-4">
                            <AITransparencyPanel
                              changes={sceneWorldStateChanges[scene.id]}
                              adherence={sceneOutcomeAdherence[scene.id]}
                              moveVariety={sceneMoveVariety[scene.id]}
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
                    <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
                      <button
                        onClick={() => setExpandedActions(prev => ({ ...prev, [scene.id]: !prev[scene.id] }))}
                        className="w-full flex items-center justify-between text-left"
                      >
                        <h3 className="font-display text-lg font-semibold text-myth-ink">
                          Player Actions ({scene.playerActions.length})
                        </h3>
                        <span className="text-myth-ink-faint">
                          {expandedActions[scene.id] ? '▼' : '▶'}
                        </span>
                      </button>
                      {expandedActions[scene.id] && (
                        <div className="space-y-3 mt-4">
                          {scene.playerActions.map((action: any) => (
                            <div key={action.id} className="bg-myth-surface-sunken rounded-lg p-4">
                              <div className="flex items-start justify-between mb-2">
                                <span className="font-medium text-myth-ink">
                                  {action.character.name}
                                </span>
                                <span className="font-mono text-xs text-myth-ink-faint">
                                  {new Date(action.createdAt).toLocaleTimeString()}
                                </span>
                              </div>
                              <p className="text-myth-ink-muted text-sm">{action.actionText}</p>
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
                  {scene.status === 'AWAITING_ACTIONS' && !scene.isPaused && !userHasSubmitted && selectedCharacterId && (
                    <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
                      <div className="flex items-center justify-between gap-3 mb-4">
                        <h3 className="font-display text-lg font-semibold text-myth-ink">Your Action</h3>
                        {scene.sceneResolutionText && (
                          <a
                            href={`/campaigns/${campaignId}/story-log`}
                            className="text-xs text-myth-ink-faint hover:text-myth-ink transition-colors whitespace-nowrap flex items-center gap-1"
                            title="Your progress is saved — come back anytime"
                          >
                            <span>Save &amp; read later</span>
                            <span className="opacity-70">📖</span>
                          </a>
                        )}
                      </div>
                      {isWaitingOnUser && (
                        <div className="bg-myth-info/10 border border-myth-info/30 text-myth-info px-3 py-2 rounded-lg mb-4 text-sm">
                          ⏳ Waiting for your action...
                        </div>
                      )}
                      <form onSubmit={(e) => handleSubmitAction(e, scene.id)} className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-myth-ink-muted mb-2">
                            What do you do?
                          </label>
                          <Textarea
                            wrapperClassName="min-h-[100px]"
                            value={actionText[scene.id] || ''}
                            onChange={(e) => setActionText(prev => ({ ...prev, [scene.id]: e.target.value }))}
                            placeholder={`What does ${selectedCharacter?.name || 'your character'} do? Be specific about their actions, intentions, and approach...`}
                            required
                          />
                        </div>

                        <Button
                          variant="primary" fullWidth
                          type="submit"
                          disabled={submitting[scene.id]}
                        >
                          {submitting[scene.id] ? 'Submitting...' : 'Submit Action'}
                        </Button>
                      </form>
                    </div>
                  )}

                  {/* User already submitted */}
                  {scene.status === 'AWAITING_ACTIONS' && userHasSubmitted && (
                    <div className="rounded-lg border border-myth-good/30 bg-myth-good/10 p-5">
                      <p className="text-myth-good text-sm">
                        ✓ You've submitted your action. Waiting for other participants...
                      </p>
                    </div>
                  )}

                  {/* Ask the GM — an out-of-character clarifying question,
                      not a turn. Available independent of whether the real
                      action has been submitted yet: asking a question
                      shouldn't be blocked by having already committed your
                      action for this exchange. */}
                  {scene.status === 'AWAITING_ACTIONS' && selectedCharacterId && (
                    <div className="rounded-lg border border-myth-border/40 bg-myth-surface/30 p-5">
                      <button
                        type="button"
                        onClick={() => setShowAskGm(prev => ({ ...prev, [scene.id]: !prev[scene.id] }))}
                        className="flex items-center justify-between w-full text-left"
                      >
                        <div>
                          <h3 className="text-sm font-medium text-myth-ink-muted">💬 Ask the GM</h3>
                          <p className="text-xs text-myth-ink-faint mt-0.5">
                            A clarifying question, out of character — this doesn&apos;t count as your action and nothing happens in the story because of it.
                          </p>
                        </div>
                        <span className="text-myth-ink-faint flex-shrink-0 ml-3">{showAskGm[scene.id] ? '▼' : '▶'}</span>
                      </button>

                      {showAskGm[scene.id] && (
                        <div className="mt-4 space-y-3">
                          {scene.gmClarifications && scene.gmClarifications.length > 0 && (
                            <div className="space-y-2">
                              {scene.gmClarifications.map((c: any) => (
                                <div key={c.id} className="bg-myth-surface-sunken rounded-lg p-3 text-sm">
                                  <p className="text-myth-ink-muted">
                                    <span className="text-xs uppercase tracking-wide text-myth-ink-faint mr-1.5">[OOC]</span>
                                    <span className="font-medium">{c.characterName || c.character?.name}</span>
                                    {' asks: '}
                                    <span className="text-myth-ink-muted">{c.question}</span>
                                  </p>
                                  <p className="text-myth-ink mt-1.5 pl-3 border-l-2 border-myth-border">{c.answer}</p>
                                </div>
                              ))}
                            </div>
                          )}

                          {askGmError[scene.id] && (
                            <p className="text-xs text-myth-danger">{askGmError[scene.id]}</p>
                          )}

                          <form onSubmit={(e) => handleAskGm(e, scene.id)} className="flex gap-2">
                            <Input
                              wrapperClassName="flex-1"
                              type="text"
                              value={askGmText[scene.id] || ''}
                              onChange={(e) => setAskGmText(prev => ({ ...prev, [scene.id]: e.target.value }))}
                              placeholder="e.g. What can I see on this person?"
                              maxLength={500}
                            />
                            <Button
                              variant="secondary"
                              type="submit"
                              disabled={askingGm[scene.id] || !askGmText[scene.id]?.trim()}
                            >
                              {askingGm[scene.id] ? 'Asking...' : 'Ask'}
                            </Button>
                          </form>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Scene controls — visible to every player: there is no
                      human GM, the AI narrates and the table drives pacing.
                      Only force-resolve (a rescue tool for a lost
                      auto-resolve) stays host-only. */}
                  {scene.status === 'AWAITING_ACTIONS' && !scene.isPaused && (() => {
                    const participants = scene.participants as any
                    const hasDefinedParticipants = participants?.scoped === true
                    const submittedUserIds = new Set((scene.playerActions || []).map((a: any) => a.userId))
                    // An open scene has no explicit roster, so its "whole
                    // party" is every living character in the campaign —
                    // same rule the backend uses to decide when to
                    // auto-resolve (see scene/route.ts).
                    const participantUserIds = hasDefinedParticipants
                      ? (participants?.userIds || [])
                      : [...new Set((campaign?.characters || []).filter((c: any) => c.isAlive !== false).map((c: any) => c.userId))]
                    const allParticipantsSubmitted = participantUserIds.length > 0 && participantUserIds.every((uid: string) => submittedUserIds.has(uid))

                    return (
                      <div className={`rounded-lg border p-5 ${allParticipantsSubmitted ? 'bg-myth-good/10 border-myth-good/30' : 'bg-myth-info/10 border-myth-info/30'}`}>
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                          <div className="flex-1">
                            <p className={`text-sm font-medium mb-1 ${allParticipantsSubmitted ? 'text-myth-good' : 'text-myth-info'}`}>
                              🎲 Scene Controls
                            </p>
                            <p className="text-myth-ink-muted text-xs mb-2">
                              {(scene.playerActions || []).length} action(s) submitted. Current exchange: {scene.currentExchange ?? 0}
                            </p>
                            {allParticipantsSubmitted ? (
                              <p className="text-myth-good text-xs mb-1">
                                ✓ Everyone has submitted — resolution starts on its own.
                              </p>
                            ) : (
                              <p className="text-myth-ink-faint text-xs">
                                ⏳ Waiting for {participantUserIds.length - submittedUserIds.size} more player(s). The scene resolves automatically when everyone has acted.
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                            {/* Host-only rescue: before everyone submits it's
                                a force, and after everyone submits it's the
                                recovery path for a lost auto-resolve — hiding
                                it in that state left stuck scenes with no way
                                out. */}
                            {isAdmin && (
                              <Button
                                variant="primary"
                                onClick={() => handleResolveScene(scene.id)}
                                disabled={resolving}
                                title={
                                  allParticipantsSubmitted
                                    ? 'Kick off resolution if auto-resolve did not start'
                                    : 'Force resolution before everyone submits'
                                }
                              >
                                {resolving
                                  ? 'Resolving...'
                                  : allParticipantsSubmitted
                                    ? 'Resolve Now'
                                    : 'Force Resolve'}
                              </Button>
                            )}
                            <Button
                              variant="secondary"
                              onClick={() => handleEndScene(scene.id)}
                              disabled={endingScene}
                              title="Ends this scene for everyone. The player who ends a scene pays its AI cost."
                            >
                              {endingScene ? 'Ending...' : 'End Scene'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )
            })
          ) : (
            <div className="rounded-lg border border-myth-border bg-myth-surface px-5 py-12">
              <div className="text-center mb-8">
                <div className="text-6xl mb-4">📜</div>
                <h2 className="font-display text-xl font-semibold text-myth-ink mb-2">
                  {resolvedScenes.length > 0 ? 'Scene Complete!' : 'No Active Scene'}
                </h2>
                <p className="text-myth-ink-muted mb-6">
                  {resolvedScenes.length > 0 ? (
                    <>The adventure continues... What happens next?</>
                  ) : (
                    <>Start a new scene to begin the adventure</>
                  )}
                </p>
              </div>

              {/* Show story context if there are resolved scenes */}
              {resolvedScenes.length > 0 && (
                <div className="max-w-2xl mx-auto mb-8">
                  <div className="bg-myth-surface-sunken rounded-lg p-4 border border-myth-border">
                    <div className="flex items-start gap-3 mb-3">
                      <span className="text-2xl">📖</span>
                      <div className="flex-1">
                        <h3 className="font-display text-myth-ink mb-1">Last Scene Summary</h3>
                        <p className="text-sm text-myth-ink-muted line-clamp-3">
                          {resolvedScenes[0].sceneResolutionText
                            ? truncateWithEllipsis(resolvedScenes[0].sceneResolutionText, 200)
                            : 'Scene resolved'}
                        </p>
                      </div>
                    </div>
                    <Link
                      href={`/campaigns/${campaignId}/story-log`}
                      className="text-xs text-myth-ink-muted hover:text-myth-ink transition-colors"
                    >
                      View complete story log →
                    </Link>
                  </div>
                </div>
              )}

              {/* Action buttons — every player can start the next scene:
                  the AI is the GM, the table drives pacing. */}
              {(
                <div className="max-w-2xl mx-auto space-y-4">
                  {!showSceneOptions ? (
                    <>
                      <Button
                        variant="primary" size="lg" fullWidth
                        onClick={handleContinueStory}
                        disabled={startingScene}
                      >
                        {startingScene ? (
                          <span className="flex items-center justify-center gap-2">
                            <Spinner className="h-5 w-5" />
                            Generating scene...
                          </span>
                        ) : (
                          <span className="flex items-center justify-center gap-2">
                            🎬 {resolvedScenes.length > 0 ? 'Continue Story' : 'Start First Scene'}
                          </span>
                        )}
                      </Button>

                      {resolvedScenes.length > 0 && campaign?.characters?.length > 0 && (
                        <Button
                          variant="ghost" size="sm" className="w-full"
                          onClick={() => setShowSceneOptions(true)}
                        >
                          ⚙️ More scene options...
                        </Button>
                      )}

                      {resolvedScenes.length > 0 && (
                        <p className="text-xs text-myth-ink-faint text-center">
                          MythOS will generate a scene that continues naturally from where you left off
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="bg-myth-surface-sunken rounded-lg border border-myth-border p-6 space-y-4">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-display text-myth-ink text-lg">Scene Creation Options</h3>
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => {
                            setShowSceneOptions(false)
                            setSelectedSceneCharacters([])
                          }}
                        >
                          ✕
                        </Button>
                      </div>

                      {/* Option 1: Continue Story */}
                      <div className="space-y-2">
                        <Button
                          variant="primary" fullWidth
                          onClick={handleContinueStory}
                          disabled={startingScene}
                        >
                          {startingScene ? 'Generating...' : '📖 Continue Story Naturally'}
                        </Button>
                        <p className="text-xs text-myth-ink-faint">
                          AI chooses the next scene based on story flow and character goals
                        </p>
                      </div>

                      <div className="border-t border-myth-border my-4"></div>

                      {/* Option 2: Full Party Scene */}
                      {campaign?.characters?.length > 1 && (
                        <>
                          <div className="space-y-2">
                            <Button
                              variant="secondary" fullWidth
                              onClick={handleFullPartyScene}
                              disabled={startingScene}
                            >
                              {startingScene ? 'Generating...' : '👥 Full Party Scene'}
                            </Button>
                            <p className="text-xs text-myth-ink-faint">
                              Create a scene with all {campaign.characters.length} characters
                            </p>
                          </div>

                          <div className="border-t border-myth-border my-4"></div>
                        </>
                      )}

                      {/* Option 3: Character-Focused Scene */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="font-display text-myth-ink text-sm">
                            🎭 Character-Focused Scene
                          </label>
                          <span className="text-xs text-myth-ink-faint">
                            {selectedSceneCharacters.length} selected
                          </span>
                        </div>

                        <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto">
                          {campaign?.characters?.map((character: any) => (
                            <label
                              key={character.id}
                              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                                selectedSceneCharacters.includes(character.id)
                                  ? 'bg-myth-accent/10 border-myth-accent/40'
                                  : 'bg-myth-surface-sunken border-myth-border hover:border-myth-border-strong'
                              }`}
                            >
                              <Checkbox
                                wrapperClassName="w-4 h-4" className="accent-myth-accent"
                                checked={selectedSceneCharacters.includes(character.id)}
                                onChange={() => toggleCharacterSelection(character.id)}
                              />
                              <div className="flex-1">
                                <div className="font-medium text-myth-ink">{character.name}</div>
                                <div className="text-xs text-myth-ink-muted truncate">
                                  {character.concept || character.description}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>

                        <Button
                          variant="secondary" fullWidth
                          onClick={handleCharacterFocusedScene}
                          disabled={startingScene || selectedSceneCharacters.length === 0}
                        >
                          {startingScene
                            ? 'Generating...'
                            : `Create Scene with ${selectedSceneCharacters.length || 0} ${pluralize(selectedSceneCharacters.length, 'Character')}`}
                        </Button>
                        <p className="text-xs text-myth-ink-faint">
                          AI will create a scene focused on the selected {pluralize(selectedSceneCharacters.length, 'character')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4 lg:space-y-6">
          <CharacterSelectorPanel
            userCharacters={userCharacters}
            selectedCharacterId={selectedCharacterId}
            onSelectCharacter={setSelectedCharacterId}
            selectedCharacter={selectedCharacter}
            onShowSnapshot={() => setShowCharacterSnapshot(true)}
          />

          <TurnOrderPanel
            currentScene={currentScene}
            sceneTurnInfo={sceneTurnInfo}
            campaignId={campaignId}
            currentUserId={user?.id || ''}
            isHost={isAdmin}
            onEndTurnOrder={handleEndTurnOrder}
            endingTurnOrder={endingTurnOrder}
            onEnableTurnOrder={handleEnableTurnOrder}
            enablingTurnOrder={enablingTurnOrder}
          />

          <MapViewerPanel
            activeMap={activeMap}
            characterName={selectedCharacter?.name || ''}
          />

          <SceneChatPanel
            currentScene={currentScene}
            user={user}
            campaignId={campaignId}
            userCharacters={userCharacters}
          />

          <ActiveClocksPanel clocks={campaign?.campaign?.clocks} campaignId={campaignId} />

          <RecentTimelinePanel timeline={campaign?.campaign?.timeline} campaignId={campaignId} />
        </div>
      </div>
      </main>

      <TavernNav campaignId={campaignId} variant="myth" />

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
            <div className="bg-myth-surface-raised border border-myth-danger/30 rounded-lg shadow-2xl shadow-black/50 p-6 animate-scale-in">
              <div className="flex items-start gap-4 mb-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-myth-danger/10 flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-myth-danger"
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
                  <h3 className="font-display text-xl font-semibold text-myth-ink mb-2">Insufficient Funds</h3>
                  <p className="text-myth-ink-muted text-sm leading-relaxed">
                    {insufficientFundsDetails}
                  </p>
                </div>
              </div>

              <div className="bg-myth-surface-sunken border border-myth-border rounded-lg p-4 mb-6">
                <p className="text-xs font-semibold text-myth-ink-muted mb-2">Pricing:</p>
                <div className="text-xs text-myth-ink-muted space-y-1">
                  <p>Each scene is billed once, when it ends, for the actual AI cost of everything that happened in it — split evenly across whoever took part. Typically a few cents per player; larger or longer scenes cost more, quiet ones cost less.</p>
                </div>
              </div>

              {addFundsError && (
                <div className="mb-4 p-3 bg-myth-danger/10 border border-myth-danger/30 rounded-lg">
                  <p className="text-sm text-myth-danger">{addFundsError}</p>
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  variant="primary" fullWidth
                  onClick={handleAddFundsFromModal}
                  disabled={addFundsLoading}
                >
                  {addFundsLoading ? 'Redirecting...' : 'Add Funds ($1.00)'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => { setShowInsufficientFunds(false); setAddFundsError('') }}
                  disabled={addFundsLoading}
                >
                  Cancel
                </Button>
              </div>

              <p className="text-xs text-myth-ink-faint mt-4 text-center">
                You will be redirected to Stripe to complete your payment securely.
              </p>
            </div>
          </div>
        </>
      )}
    </TavernPage>
  )
}
