// src/app/campaigns/[id]/page.tsx
// Campaign lobby - shows campaign info, players, characters
// UPDATED WITH PHASE 8 COMMUNICATION FEATURES

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { authenticatedFetch, isAuthenticated, getUser, setLastCampaignId } from '@/lib/clientAuth'
import EnhancedCreateCharacterForm from "@/components/forms/EnhancedCreateCharacterForm"
import ChatPanel from '@/components/chat/ChatPanel'
import NotesPanel from '@/components/notes/NotesPanel'
import NotificationPanel from '@/components/notifications/NotificationPanel'
import TurnTracker from '@/components/turns/TurnTracker'
import { PlayerMapViewer } from '@/components/maps/PlayerMapViewer'
import InviteModal from '@/components/campaigns/InviteModal'
import { Home, Scroll, MessageSquare, StickyNote, Map as MapIcon, Settings as SettingsIcon, Plus, MapPin, UserPlus } from 'lucide-react'
import { displayFont } from '@/lib/tavernTheme'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { TavernCard, TavernButton, TavernSpinner } from '@/components/tavern/ui'

interface CampaignData {
  campaign: any
  userRole: 'ADMIN' | 'PLAYER'
}

const VALID_TABS = ['overview', 'chat', 'notes', 'maps', 'progression'] as const
type LobbyTab = (typeof VALID_TABS)[number]

export default function CampaignLobbyPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const campaignId = params.id as string

  const initialTab = (VALID_TABS as readonly string[]).includes(searchParams.get('tab') || '')
    ? (searchParams.get('tab') as LobbyTab)
    : 'overview'

  const [data, setData] = useState<CampaignData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateCharacter, setShowCreateCharacter] = useState(false)
  const [activeTab, setActiveTabState] = useState<LobbyTab>(initialTab)

  const setActiveTab = (tab: LobbyTab) => {
    setActiveTabState(tab)
    router.replace(`/campaigns/${campaignId}${tab === 'overview' ? '' : `?tab=${tab}`}`, { scroll: false })
  }
  const [showNotifications, setShowNotifications] = useState(false)
  const [deletingCharacterId, setDeletingCharacterId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [maps, setMaps] = useState<any[]>([])
  const [mapsLoading, setMapsLoading] = useState(false)
  const [showCreateMap, setShowCreateMap] = useState(false)
  const [newMapName, setNewMapName] = useState('')
  const [newMapDescription, setNewMapDescription] = useState('')
  const [creatingMap, setCreatingMap] = useState(false)
  const [campaignLogs, setCampaignLogs] = useState<any[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)

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
      setLastCampaignId(campaignId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaign')
    } finally {
      setLoading(false)
    }
  }

  // While the world is being seeded from canon lore (creation-time
  // import + auto-reseed), play is locked server-side — poll until the
  // banner can come down. The poll itself drives the server's stale-flag
  // self-heal and stuck-import recovery.
  const worldSeeding = Boolean((data as any)?.campaign?.pendingWorldSeed)
  useEffect(() => {
    if (!worldSeeding) return
    const interval = setInterval(loadCampaign, 8000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldSeeding, campaignId])

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

  const loadMaps = async () => {
    setMapsLoading(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/maps`)
      if (response.ok) {
        const data = await response.json()
        setMaps(data.maps || [])
      }
    } catch (err) {
      console.error('Failed to load maps:', err)
    } finally {
      setMapsLoading(false)
    }
  }

  // Load maps when switching to maps tab
  useEffect(() => {
    if (activeTab === 'maps') {
      loadMaps()
    } else if (activeTab === 'progression') {
      loadCampaignLogs()
    }
  }, [activeTab])

  const loadCampaignLogs = async () => {
    setLogsLoading(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/logs`)
      if (response.ok) {
        const data = await response.json()
        setCampaignLogs(data.logs || [])
      }
    } catch (err) {
      console.error('Failed to load campaign logs:', err)
    } finally {
      setLogsLoading(false)
    }
  }

  if (loading) {
    return (
      <TavernPage>
        <TavernHeader backHref="/campaigns" title="Loading…" campaignId={campaignId} />
        <main className="max-w-6xl mx-auto px-4 pt-28 pb-16">
          <TavernSpinner className="h-16 w-16" />
        </main>
      </TavernPage>
    )
  }

  if (error || !data) {
    return (
      <TavernPage>
        <TavernHeader backHref="/campaigns" title="Campaign" campaignId={campaignId} />
        <main className="max-w-2xl mx-auto px-4 pt-28 pb-16">
          <TavernCard className="p-6">
            <p className="text-wine-400">{error || 'Campaign not found'}</p>
            <Link href="/campaigns" className="text-ember-300 hover:text-ember-200 hover:underline mt-4 inline-block">
              ← Back to campaigns
            </Link>
          </TavernCard>
        </main>
      </TavernPage>
    )
  }

  const { campaign, userRole } = data
  const currentUser = getUser()
  const userCharacters = campaign.characters.filter(
    (c: any) => c.userId === currentUser?.id
  )

  const tabIcons = { overview: Home, progression: Scroll, chat: MessageSquare, notes: StickyNote, maps: MapIcon } as const

  return (
    <TavernPage>
      <TavernHeader
        backHref="/campaigns"
        title={campaign.title}
        campaignId={campaignId}
        isAdmin={userRole === 'ADMIN'}
        subrow={
          <nav className="max-w-6xl mx-auto px-4 flex items-center gap-1 overflow-x-auto text-sm border-t border-ember-900/20 pt-2 pb-0">
            {[
              { key: 'overview', label: 'Overview' },
              { key: 'progression', label: 'Story Log' },
              { key: 'chat', label: 'Chat' },
              { key: 'notes', label: 'Notes' },
              { key: 'maps', label: 'Maps' },
            ].map((tab) => {
              const TabIcon = tabIcons[tab.key as keyof typeof tabIcons]
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as any)}
                  className={`flex items-center gap-1.5 px-3 py-2 border-b-2 whitespace-nowrap flex-shrink-0 transition-colors ${
                    activeTab === tab.key ? 'border-ember-400 text-ember-200' : 'border-transparent text-ember-300/40 hover:text-ember-300/70'
                  }`}
                >
                  <TabIcon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </nav>
        }
      />

      <main className="max-w-6xl mx-auto px-4 pt-28 pb-28">
        {/* World-seeding lock: canon lore is still being imported and the
            world rebuilt from it — play opens when this clears. */}
        {worldSeeding && (
          <div className="mb-6 rounded-xl bg-gradient-to-r from-ember-900/40 to-wine-900/30 border border-ember-600/40 px-5 py-4 flex items-center gap-4">
            <div className="spinner h-8 w-8 flex-shrink-0"></div>
            <div>
              <p className="font-semibold text-ember-100">The world is being forged from your canon lore…</p>
              <p className="text-sm text-ember-300/60 mt-0.5">
                Importing and rebuilding factions, powers, and character archetypes from the source material.
                Characters and scenes unlock when it finishes — usually a few minutes for a whole wiki.
                This page updates automatically.
              </p>
            </div>
          </div>
        )}

        {/* Campaign summary */}
        <div className="mb-8">
          <p className="text-sm sm:text-base text-ember-300/60 leading-relaxed mb-3">{campaign.description}</p>
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-black/30 rounded-lg border border-ember-900/30">
              <span className="text-ember-400/50">Universe:</span>
              <span className="text-ember-100 font-medium">{campaign.universe}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-black/30 rounded-lg border border-ember-900/30">
              <span className="text-ember-400/50">Turn:</span>
              <span className="text-ember-300 font-medium">{campaign.worldMeta?.currentTurnNumber || 0}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-black/30 rounded-lg border border-ember-900/30">
              <span className="text-ember-400/50">Date:</span>
              <span className="text-ember-100 font-medium truncate max-w-[150px] sm:max-w-none">{campaign.worldMeta?.currentInGameDate || 'Day 1'}</span>
            </div>
            {userRole === 'ADMIN' && (
              <Link
                href={`/campaigns/${campaignId}/admin`}
                className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-300 hover:text-ember-200 hover:border-ember-700/50 transition-colors"
              >
                <SettingsIcon className="w-4 h-4" />
                Settings
              </Link>
            )}
          </div>
        </div>

      {/* Overview Tab - Existing Content */}
      {activeTab === 'overview' && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Enter Story Button */}
          <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
            <h2 className="text-lg font-bold text-ember-100">Ready to Play?</h2>
            <p className="text-ember-300/60 mb-4">
              {userCharacters.length === 0
                ? 'Create a character first to enter the story'
                : 'Jump into the adventure!'}
            </p>
            <Link
              href={`/campaigns/${campaignId}/story`}
              className={`px-4 py-2.5 rounded-lg bg-gradient-to-b from-wine-500 to-wine-700 hover:from-wine-400 hover:to-wine-600 text-ember-100 font-medium border border-ember-900/50 shadow-lg shadow-black/40 transition-all text-center inline-block ${
                userCharacters.length === 0 ? 'opacity-50 pointer-events-none' : ''
              }`}
            >
              🎭 Enter Story
            </Link>
          </div>

          {/* Your Characters */}
          <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-ember-100 mb-0">Your Characters</h2>
              <button
                type="button"
                onClick={() => setShowCreateCharacter(true)}
                className="text-ember-300 hover:text-ember-200 text-sm"
              >
                + Create Character
              </button>
            </div>

            {userCharacters.length === 0 ? (
              <p className="text-ember-400/50 text-sm">No characters yet. Create one to play!</p>
            ) : (
              <div className="space-y-3">
                {userCharacters.map((character: any) => (
                  <div key={character.id} className="bg-black/30 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-bold text-ember-100">{character.name}</h3>
                        <p className="text-sm text-ember-300/60">{character.concept}</p>
                        {character.currentLocation && (
                          <p className="text-xs text-ember-400/50 mt-1">
                            📍 {character.currentLocation}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded text-xs ${
                          character.isAlive
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-black/30 text-ember-300/60'
                        }`}>
                          {character.isAlive ? 'Alive' : 'Dead'}
                        </span>
                        <button
                          onClick={() => setDeletingCharacterId(character.id)}
                          className="text-wine-400 hover:text-wine-300 text-xs px-2 py-1 rounded hover:bg-wine-800/20"
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
                            className="px-2 py-1 bg-wine-800/30 text-wine-400 rounded text-xs"
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
          <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
            <h2 className="text-lg font-bold text-ember-100">All Characters</h2>
            <div className="space-y-2">
              {campaign.characters.map((character: any) => {
                const currentUser = getUser()
                const isMyCharacter = currentUser && character.userId === currentUser.id

                return (
                  <Link
                    key={character.id}
                    href={`/campaigns/${campaignId}/characters/${character.id}`}
                    className={`flex items-center justify-between py-2 px-3 rounded transition-colors group ${
                      isMyCharacter
                        ? 'bg-wine-800/20 border border-wine-600/40 hover:bg-wine-800/30'
                        : 'hover:bg-black/30'
                    }`}
                  >
                    <div>
                      <span className={`font-medium ${isMyCharacter ? 'text-ember-200' : 'text-ember-100'} group-hover:text-ember-200`}>
                        {character.name}
                        {isMyCharacter && (
                          <span className="ml-2 text-xs bg-wine-600 text-ember-100 px-2 py-0.5 rounded">You</span>
                        )}
                      </span>
                      <span className="text-ember-400/50 text-sm ml-2">
                        ({character.user.name || character.user.email})
                      </span>
                    </div>
                    <span className="text-ember-500/40 group-hover:text-ember-300">→</span>
                  </Link>
                )
              })}
              {campaign.characters.length === 0 && (
                <p className="text-ember-400/50 text-sm">No characters in this campaign yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Players */}
          <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-ember-100 mb-0">Players ({campaign.memberships.length})</h2>
              {userRole === 'ADMIN' && (
                <button
                  onClick={() => setShowInviteModal(true)}
                  className="text-ember-300 hover:text-ember-200 text-sm"
                  title="Invite players"
                >
                  + Invite
                </button>
              )}
            </div>
            <div className="space-y-2">
              {campaign.memberships.map((member: any) => (
                <div key={member.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${member.user.isOnline ? 'bg-green-500' : 'bg-ember-900/60'}`} />
                    <span className="text-sm text-ember-200/80">{member.user.name || member.user.email}</span>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs ${
                    member.role === 'ADMIN'
                      ? 'bg-ember-900/30 text-ember-300'
                      : 'bg-black/30 text-ember-200/80'
                  }`}>
                    {member.role}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
            <h2 className="text-lg font-bold text-ember-100">Campaign Stats</h2>
            <p className="text-xs text-ember-400/50 mb-3">Click to view in wiki</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ember-300/60">Scenes:</span>
                <span className="text-ember-100 font-medium">{campaign.scenes.length}</span>
              </div>
              <Link
                href={`/campaigns/${campaignId}/characters`}
                className="flex justify-between hover:bg-black/30 p-2 -m-2 rounded transition-colors group"
              >
                <span className="text-ember-300/60 group-hover:text-ember-200 transition-colors">
                  Characters:
                </span>
                <span className="text-ember-100 font-medium group-hover:text-ember-200 transition-colors">
                  {campaign.characters.length} →
                </span>
              </Link>
              <Link
                href={`/campaigns/${campaignId}/wiki?type=NPC`}
                className="flex justify-between hover:bg-black/30 p-2 -m-2 rounded transition-colors group"
              >
                <span className="text-ember-300/60 group-hover:text-ember-200 transition-colors">
                  NPCs:
                </span>
                <span className="text-ember-100 font-medium group-hover:text-ember-200 transition-colors">
                  {campaign.npcs.length} →
                </span>
              </Link>
              <Link
                href={`/campaigns/${campaignId}/wiki?type=FACTION`}
                className="flex justify-between hover:bg-black/30 p-2 -m-2 rounded transition-colors group"
              >
                <span className="text-ember-300/60 group-hover:text-ember-200 transition-colors">
                  Factions:
                </span>
                <span className="text-ember-100 font-medium group-hover:text-ember-200 transition-colors">
                  {campaign.factions.length} →
                </span>
              </Link>
              <Link
                href={`/campaigns/${campaignId}/wiki?type=LOCATION`}
                className="flex justify-between hover:bg-black/30 p-2 -m-2 rounded transition-colors group"
              >
                <span className="text-ember-300/60 group-hover:text-ember-200 transition-colors">
                  Locations:
                </span>
                <span className="text-ember-100 font-medium group-hover:text-ember-200 transition-colors">
                  {campaign.locations?.length ?? 0} →
                </span>
              </Link>
              <Link
                href={`/campaigns/${campaignId}/wiki?type=CLOCK`}
                className="flex justify-between hover:bg-black/30 p-2 -m-2 rounded transition-colors group"
              >
                <span className="text-ember-300/60 group-hover:text-ember-200 transition-colors">
                  Active Clocks:
                </span>
                <span className="text-ember-100 font-medium group-hover:text-ember-200 transition-colors">
                  {campaign.clocks.length} →
                </span>
              </Link>
              {/* Items/quests/rumors aren't included in this page's campaign
                  payload, so these are link-only rows — the wiki tab itself
                  shows the live list. */}
              <Link
                href={`/campaigns/${campaignId}/wiki?type=ITEM`}
                className="flex justify-between hover:bg-black/30 p-2 -m-2 rounded transition-colors group"
              >
                <span className="text-ember-300/60 group-hover:text-ember-200 transition-colors">
                  Items:
                </span>
                <span className="text-ember-100 font-medium group-hover:text-ember-200 transition-colors">
                  →
                </span>
              </Link>
              <Link
                href={`/campaigns/${campaignId}/wiki?type=QUEST`}
                className="flex justify-between hover:bg-black/30 p-2 -m-2 rounded transition-colors group"
              >
                <span className="text-ember-300/60 group-hover:text-ember-200 transition-colors">
                  Quests:
                </span>
                <span className="text-ember-100 font-medium group-hover:text-ember-200 transition-colors">
                  →
                </span>
              </Link>
              <Link
                href={`/campaigns/${campaignId}/wiki?type=RUMORS`}
                className="flex justify-between hover:bg-black/30 p-2 -m-2 rounded transition-colors group"
              >
                <span className="text-ember-300/60 group-hover:text-ember-200 transition-colors">
                  Rumors:
                </span>
                <span className="text-ember-100 font-medium group-hover:text-ember-200 transition-colors">
                  →
                </span>
              </Link>
              <Link
                href={`/campaigns/${campaignId}/wiki`}
                className="flex justify-between hover:bg-black/30 p-2 -m-2 rounded transition-colors group border-t border-ember-900/30 mt-2 pt-3"
              >
                <span className="text-ember-300 group-hover:text-ember-200 transition-colors font-medium">
                  Open full wiki
                </span>
                <span className="text-ember-100 font-medium group-hover:text-ember-200 transition-colors">
                  →
                </span>
              </Link>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Progression/Story Log Tab */}
      {activeTab === 'progression' && data && (
        <div className="max-w-6xl mx-auto">
          <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
            <h2 className="text-lg font-bold text-ember-100 mb-4">Campaign Story Log</h2>
            <p className="text-ember-300/60 mb-6">
              A chronicle of your adventure, updated after each scene
            </p>

            {logsLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ember-400"></div>
              </div>
            ) : campaignLogs.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📜</div>
                <p className="text-ember-300/60 mb-2">No story entries yet</p>
                <p className="text-sm text-ember-400/50">
                  The story log will be automatically updated as scenes are resolved
                </p>
              </div>
            ) : (
              <>
                {/* Timeline Bar */}
                <div className="mb-8 bg-black/20 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-ember-300/60">Campaign Progress</span>
                    <span className="text-sm text-ember-400/50">
                      Turn {campaignLogs[campaignLogs.length - 1]?.turnNumber || 0}
                    </span>
                  </div>
                  <div className="relative h-2 bg-black/30 rounded-full overflow-hidden">
                    <div
                      className="absolute top-0 left-0 h-full bg-gradient-to-r from-ember-600 to-ember-400 transition-all"
                      style={{ width: `${Math.min((campaignLogs.length / 20) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-2 text-xs text-ember-400/50">
                    <span>{campaignLogs.length} scenes completed</span>
                    <span>Milestone at 20 scenes</span>
                  </div>
                </div>

                {/* Log Entries */}
                <div className="space-y-4">
                  {campaignLogs.map((log: any, index: number) => (
                    <div
                      key={log.id}
                      className="bg-black/30 rounded-lg p-4 border border-ember-900/30 hover:border-ember-700/40 transition-colors"
                    >
                      {/* Header */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-ember-300">
                              Turn {log.turnNumber}
                            </span>
                            {log.entryType !== 'scene' && (
                              <span className="text-xs px-2 py-0.5 bg-black/30 text-ember-200/80 rounded">
                                {log.entryType}
                              </span>
                            )}
                          </div>
                          <h3 className="text-lg font-bold text-ember-100">{log.title}</h3>
                          {log.inGameDate && (
                            <p className="text-xs text-ember-400/50 mt-1">
                              📅 {log.inGameDate}
                              {log.duration && ` • Duration: ${log.duration}`}
                            </p>
                          )}
                        </div>
                        <span className="text-xs text-ember-400/50">
                          {new Date(log.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                      {/* Summary */}
                      <p className="text-ember-200/80 mb-3 whitespace-pre-wrap">{log.summary}</p>

                      {/* Highlights */}
                      {log.highlights && log.highlights.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-ember-900/30">
                          <h4 className="text-xs font-medium text-ember-300/60 mb-2">
                            Key Moments:
                          </h4>
                          <ul className="space-y-1">
                            {log.highlights.map((highlight: string, i: number) => (
                              <li key={i} className="text-sm text-ember-300/60 flex items-start gap-2">
                                <span className="text-ember-400 mt-1">•</span>
                                <span>{highlight}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Chat Tab - Phase 8 Communication */}
      {activeTab === 'chat' && data && (
        <div className="max-w-6xl mx-auto">
          <ChatPanel
            campaignId={campaignId}
            currentUserId={getUser()?.id || ''}
            currentUserName={getUser()?.email || 'Unknown'}
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
            currentUserId={getUser()?.id || ''}
            characters={data.campaign.characters}
            npcs={data.campaign.npcs || []}
            factions={data.campaign.factions || []}
            scenes={data.campaign.scenes || []}
          />
        </div>
      )}

      {/* Maps Tab */}
      {activeTab === 'maps' && data && (
        <div className="max-w-6xl mx-auto">
          <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-ember-100 mb-0">Campaign Maps</h2>
              {userRole === 'ADMIN' && (
                <button
                  onClick={() => setShowCreateMap(true)}
                  className="text-ember-300 hover:text-ember-200 text-sm"
                >
                  + Create Map
                </button>
              )}
            </div>

            {/* Create Map Form */}
            {showCreateMap && userRole === 'ADMIN' && (
              <div className="bg-black/30 rounded-lg p-4 mb-4 border border-ember-900/30">
                <h3 className="text-ember-100 font-bold mb-3">Create New Map</h3>
                <form onSubmit={async (e) => {
                  e.preventDefault()
                  if (!newMapName.trim()) return

                  setCreatingMap(true)
                  try {
                    const response = await authenticatedFetch(`/api/campaigns/${campaignId}/maps`, {
                      method: 'POST',
                      body: JSON.stringify({
                        name: newMapName,
                        description: newMapDescription,
                        width: 800,
                        height: 600,
                        gridSize: 40
                      })
                    })

                    if (!response.ok) {
                      const data = await response.json()
                      throw new Error(data.error || 'Failed to create map')
                    }

                    setNewMapName('')
                    setNewMapDescription('')
                    setShowCreateMap(false)
                    // Reload maps
                    loadMaps()
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to create map')
                  } finally {
                    setCreatingMap(false)
                  }
                }}>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-ember-300/60 mb-1">Map Name</label>
                      <input
                        type="text"
                        value={newMapName}
                        onChange={(e) => setNewMapName(e.target.value)}
                        className="px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 w-full"
                        placeholder="e.g., Tavern Floor Plan, Dungeon Level 1"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-ember-300/60 mb-1">Description</label>
                      <textarea
                        value={newMapDescription}
                        onChange={(e) => setNewMapDescription(e.target.value)}
                        className="px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 w-full"
                        rows={2}
                        placeholder="Optional description"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={creatingMap || !newMapName.trim()}
                        className="px-4 py-2.5 rounded-lg bg-gradient-to-b from-wine-500 to-wine-700 hover:from-wine-400 hover:to-wine-600 text-ember-100 font-medium border border-ember-900/50 shadow-lg shadow-black/40 transition-all text-center"
                      >
                        {creatingMap ? 'Creating...' : 'Create Map'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateMap(false)
                          setNewMapName('')
                          setNewMapDescription('')
                        }}
                        className="px-4 py-2.5 rounded-lg bg-black/30 hover:bg-black/40 border border-ember-900/40 text-ember-300 font-medium transition-colors text-center"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            )}

            {/* Maps List */}
            {mapsLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ember-400"></div>
              </div>
            ) : maps.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🗺️</div>
                <p className="text-ember-300/60 mb-2">No maps yet</p>
                <p className="text-sm text-ember-400/50">
                  {userRole === 'ADMIN'
                    ? 'Create a map to visualize locations and track character positions'
                    : 'The GM will create maps as the adventure unfolds'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {maps.map((map: any) => (
                  <div key={map.id} className="bg-black/30 rounded-lg p-4 border border-ember-900/30">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-bold text-ember-100">{map.name}</h3>
                          {map.isActive && (
                            <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded">
                              Active
                            </span>
                          )}
                        </div>
                        {map.description && (
                          <p className="text-sm text-ember-300/60">{map.description}</p>
                        )}
                        <div className="flex items-center gap-4 text-xs text-ember-400/50 mt-2">
                          <span>{map.tokens?.length || 0} tokens</span>
                          <span>{map.zones?.length || 0} zones</span>
                          <span>{map.width}×{map.height}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {userRole === 'ADMIN' && !map.isActive && (
                          <button
                            onClick={async () => {
                              try {
                                const response = await authenticatedFetch(
                                  `/api/campaigns/${campaignId}/maps/active`,
                                  {
                                    method: 'PUT',
                                    body: JSON.stringify({ mapId: map.id })
                                  }
                                )
                                if (response.ok) {
                                  loadMaps()
                                }
                              } catch (err) {
                                console.error('Failed to set active map:', err)
                              }
                            }}
                            className="text-xs px-3 py-1 bg-wine-600 hover:bg-wine-500 text-ember-100 rounded"
                          >
                            Set Active
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Map Preview */}
                    <div className="rounded-lg overflow-hidden border border-ember-900/30 bg-black/20">
                      <PlayerMapViewer
                        map={map}
                        characterName={userCharacters[0]?.name || ''}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      </main>

      <TavernNav campaignId={campaignId} />

      {/* Notification Panel - Phase 8/9 Communication */}
      {data && (
        <NotificationPanel
          userId={getUser()?.id || ''}
          campaignId={campaignId}
          isOpen={showNotifications}
          onClose={() => setShowNotifications(false)}
        />
      )}

      {/* Character Creation Modal */}
      {showCreateCharacter && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-2 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-tavern-900 border border-ember-900/40 rounded-lg max-w-2xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto p-4 sm:p-6 my-auto">
            <h2 className="text-xl sm:text-2xl font-bold mb-4 text-ember-100">Create New Character</h2>
            <EnhancedCreateCharacterForm
              campaignId={campaignId}
              statLabels={campaign.statLabels}
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
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-tavern-900 border border-ember-900/40 rounded-lg max-w-md w-full p-4 sm:p-6">
            <h2 className="text-xl sm:text-2xl font-bold mb-4 text-ember-100">Delete Character?</h2>
            <p className="text-sm sm:text-base text-ember-300/60 mb-6">
              Are you sure you want to delete this character? This action cannot be undone.
              All associated actions and data will be permanently removed.
            </p>
            {deleteError && (
              <div className="bg-wine-800/20 border border-wine-600/40 text-wine-400 px-4 py-3 rounded-lg mb-4 text-sm">
                {deleteError}
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => {
                  setDeletingCharacterId(null)
                  setDeleteError('')
                }}
                className="px-4 py-2.5 rounded-lg bg-black/30 hover:bg-black/40 border border-ember-900/40 text-ember-300 font-medium transition-colors text-center flex-1 touch-manipulation min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteCharacter(deletingCharacterId)}
                className="bg-wine-600 hover:bg-wine-500 text-ember-100 px-4 py-2 rounded-lg transition-colors flex-1 touch-manipulation min-h-[44px]"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      <InviteModal
        campaignId={campaignId}
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
      />
    </TavernPage>
  )
}
