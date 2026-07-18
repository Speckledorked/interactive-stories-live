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
import { Home, Scroll, MessageSquare, StickyNote, Map as MapIcon } from 'lucide-react'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { EmptyState } from '@/components/ui/empty-state'
import { CampaignHero } from '@/components/campaigns/lobby/CampaignHero'
import { CampaignEntryCTA } from '@/components/campaigns/lobby/CampaignEntryCTA'
import { CharacterRoster } from '@/components/campaigns/lobby/CharacterRoster'
import { PlayersPanel } from '@/components/campaigns/lobby/PlayersPanel'
import { WorldSummaryPanel } from '@/components/campaigns/lobby/WorldSummaryPanel'

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
  const [awayRecap, setAwayRecap] = useState<{ awayLabel: string; events: Array<{ id: string; title: string; summary: string }> } | null>(null)
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([])
  const [blockingUserId, setBlockingUserId] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    loadCampaign()
    loadBlocks()

    // Dedicated endpoint, not the main campaign GET: this page is the "I
    // came back and looked" checkpoint. The story page reloads via this
    // same GET constantly on Pusher events and would reset the away-window
    // before a returning player ever saw it.
    authenticatedFetch(`/api/campaigns/${campaignId}/away-recap`)
      .then(res => (res.ok ? res.json() : null))
      .then(json => setAwayRecap(json?.recap ?? null))
      .catch(() => {})
  }, [campaignId])

  const loadBlocks = async () => {
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/block`)
      if (response.ok) {
        const json = await response.json()
        setBlockedUserIds(json.blockedUserIds || [])
      }
    } catch {
      // Non-critical — the block toggle just won't reflect current state.
    }
  }

  const toggleBlock = async (targetUserId: string) => {
    setBlockingUserId(targetUserId)
    const isBlocked = blockedUserIds.includes(targetUserId)
    try {
      const response = await authenticatedFetch(
        isBlocked
          ? `/api/campaigns/${campaignId}/block?blockedUserId=${targetUserId}`
          : `/api/campaigns/${campaignId}/block`,
        isBlocked
          ? { method: 'DELETE' }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ blockedUserId: targetUserId }),
            }
      )
      if (response.ok) {
        setBlockedUserIds(prev =>
          isBlocked ? prev.filter(id => id !== targetUserId) : [...prev, targetUserId]
        )
      }
    } finally {
      setBlockingUserId(null)
    }
  }

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
      <TavernPage background="myth">
        <TavernHeader backHref="/campaigns" title="Loading…" campaignId={campaignId} variant="myth" />
        <main className="flex justify-center max-w-6xl mx-auto px-4 pt-28 pb-16">
          <div className="h-16 w-16 animate-spin rounded-full border-b-2 border-myth-accent" />
        </main>
      </TavernPage>
    )
  }

  if (error || !data) {
    return (
      <TavernPage background="myth">
        <TavernHeader backHref="/campaigns" title="Campaign" campaignId={campaignId} variant="myth" />
        <main className="max-w-2xl mx-auto px-4 pt-28 pb-16">
          <div className="rounded-lg border border-myth-border bg-myth-surface p-6">
            <p className="text-myth-danger">{error || 'Campaign not found'}</p>
            <Link href="/campaigns" className="mt-4 inline-block text-myth-ink-muted hover:text-myth-ink hover:underline">
              ← Back to campaigns
            </Link>
          </div>
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
    <TavernPage background="myth">
      <TavernHeader
        backHref="/campaigns"
        title={campaign.title}
        campaignId={campaignId}
        isAdmin={userRole === 'ADMIN'}
        variant="myth"
        subrow={
          <nav className="max-w-6xl mx-auto px-4 flex items-center gap-1 overflow-x-auto text-sm border-t border-myth-border pt-2 pb-0">
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
                    activeTab === tab.key ? 'border-myth-accent text-myth-ink' : 'border-transparent text-myth-ink-faint hover:text-myth-ink-muted'
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
          <div className="mb-6 flex items-center gap-4 rounded-lg border border-myth-info/30 bg-myth-info/10 px-5 py-4">
            <div className="spinner h-8 w-8 flex-shrink-0"></div>
            <div>
              <p className="font-medium text-myth-ink">The world is being forged from your canon lore…</p>
              <p className="mt-0.5 text-sm text-myth-ink-muted">
                Importing and rebuilding factions, powers, and character archetypes from the source material.
                Characters and scenes unlock when it finishes — usually a few minutes for a whole wiki.
                This page updates automatically.
              </p>
            </div>
          </div>
        )}

        {/* "While you were away" — offscreen world-turn fallout the player
            missed since they last opened this lobby. Dismissible; not
            persisted as dismissed (it naturally won't reappear once
            lastViewedAt advances past these events). */}
        {awayRecap && (
          <div className="mb-6 rounded-lg border border-myth-border bg-myth-surface-sunken px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-display font-medium text-myth-ink">
                  While you were away ({awayRecap.awayLabel})…
                </p>
                <p className="mt-0.5 text-xs text-myth-ink-faint">The world kept moving without you.</p>
              </div>
              <button
                onClick={() => setAwayRecap(null)}
                className="flex-shrink-0 text-sm text-myth-ink-faint hover:text-myth-ink-muted"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
            <ul className="mt-3 space-y-2">
              {awayRecap.events.map((e) => (
                <li key={e.id} className="border-l-2 border-myth-border pl-3 text-sm text-myth-ink-muted">
                  <span className="font-medium text-myth-ink">{e.title}.</span> {e.summary}
                </li>
              ))}
            </ul>
            <Link
              href={`/campaigns/${campaignId}/wiki?type=RUMORS`}
              className="mt-3 inline-block text-xs text-myth-ink-muted underline hover:text-myth-ink"
            >
              See everything that's happened →
            </Link>
          </div>
        )}

        <CampaignHero
          title={campaign.title}
          description={campaign.description}
          universe={campaign.universe}
          turnNumber={campaign.worldMeta?.currentTurnNumber || 0}
          inGameDate={campaign.worldMeta?.currentInGameDate || 'Day 1'}
        />

      {/* Overview Tab - Existing Content */}
      {activeTab === 'overview' && (
      <div className="space-y-6">
        <CampaignEntryCTA
          campaignId={campaignId}
          hasCharacter={userCharacters.length > 0}
          onCreateCharacter={() => setShowCreateCharacter(true)}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <CharacterRoster
              characters={campaign.characters}
              currentUserId={currentUser?.id}
              campaignId={campaignId}
              activePlayerCount={campaign.memberships.length}
              onCreateCharacter={() => setShowCreateCharacter(true)}
              onDeleteCharacter={(characterId) => setDeletingCharacterId(characterId)}
            />
          </div>
          <div>
            <PlayersPanel
              memberships={campaign.memberships}
              currentUserId={currentUser?.id}
              blockedUserIds={blockedUserIds}
              blockingUserId={blockingUserId}
              onToggleBlock={toggleBlock}
              isAdmin={userRole === 'ADMIN'}
              onInvite={() => setShowInviteModal(true)}
            />
          </div>
        </div>

        <WorldSummaryPanel
          campaignId={campaignId}
          factionCount={campaign.factions.length}
          clockCount={campaign.clocks.length}
          inGameDate={campaign.worldMeta?.currentInGameDate || 'Day 1'}
          characterCount={campaign.characters.length}
          npcCount={campaign.npcs.length}
          locationCount={campaign.locations?.length ?? 0}
        />
      </div>
      )}

      {/* Progression/Story Log Tab */}
      {activeTab === 'progression' && data && (
        <div className="mx-auto max-w-6xl">
          <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
            <h2 className="font-display text-lg font-semibold text-myth-ink">Campaign Story Log</h2>
            <p className="mb-6 mt-1 text-myth-ink-muted">A chronicle of your adventure, updated after each scene</p>

            {logsLoading ? (
              <div className="flex justify-center py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-myth-accent"></div>
              </div>
            ) : campaignLogs.length === 0 ? (
              <EmptyState
                title="No story entries yet"
                description="The story log will be automatically updated as scenes are resolved."
              />
            ) : (
              <>
                {/* Timeline Bar */}
                <div className="mb-8 rounded-md border border-myth-border bg-myth-surface-sunken p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-myth-ink-muted">Campaign Progress</span>
                    <span className="font-mono text-sm text-myth-ink-faint">
                      Turn {campaignLogs[campaignLogs.length - 1]?.turnNumber || 0}
                    </span>
                  </div>
                  <div className="relative h-1.5 overflow-hidden rounded-full bg-myth-border">
                    <div
                      className="absolute left-0 top-0 h-full bg-myth-accent transition-all"
                      style={{ width: `${Math.min((campaignLogs.length / 20) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-myth-ink-faint">
                    <span>{campaignLogs.length} scenes completed</span>
                    <span>Milestone at 20 scenes</span>
                  </div>
                </div>

                {/* Log Entries */}
                <div className="space-y-4">
                  {campaignLogs.map((log: any) => (
                    <div
                      key={log.id}
                      className="rounded-md border border-myth-border p-4 transition-colors hover:border-myth-border-strong"
                    >
                      {/* Header */}
                      <div className="mb-3 flex items-start justify-between">
                        <div className="flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="font-mono text-xs text-myth-ink-muted">Turn {log.turnNumber}</span>
                            {log.entryType !== 'scene' && (
                              <span className="rounded bg-myth-ink/5 px-2 py-0.5 text-xs text-myth-ink-muted">
                                {log.entryType}
                              </span>
                            )}
                          </div>
                          <h3 className="font-display text-lg font-semibold text-myth-ink">{log.title}</h3>
                          {log.inGameDate && (
                            <p className="mt-1 text-xs text-myth-ink-faint">
                              {log.inGameDate}
                              {log.duration && ` • Duration: ${log.duration}`}
                            </p>
                          )}
                        </div>
                        <span className="text-xs text-myth-ink-faint">
                          {new Date(log.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                      {/* Summary */}
                      <p className="mb-3 whitespace-pre-wrap text-myth-ink-muted">{log.summary}</p>

                      {/* Highlights */}
                      {log.highlights && log.highlights.length > 0 && (
                        <div className="mt-3 border-t border-myth-border pt-3">
                          <h4 className="mb-2 text-xs font-medium text-myth-ink-muted">Key Moments:</h4>
                          <ul className="space-y-1">
                            {log.highlights.map((highlight: string, i: number) => (
                              <li key={i} className="flex items-start gap-2 text-sm text-myth-ink-muted">
                                <span className="mt-1 text-myth-ink-faint">•</span>
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
        <div className="mx-auto max-w-6xl">
          <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-myth-ink">Campaign Maps</h2>
              {userRole === 'ADMIN' && (
                <button
                  onClick={() => setShowCreateMap(true)}
                  className="text-sm text-myth-ink-muted hover:text-myth-ink"
                >
                  + Create Map
                </button>
              )}
            </div>

            {/* Create Map Form */}
            {showCreateMap && userRole === 'ADMIN' && (
              <div className="mb-4 rounded-md border border-myth-border bg-myth-surface-sunken p-4">
                <h3 className="mb-3 font-medium text-myth-ink">Create New Map</h3>
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
                      <label className="mb-1 block text-sm text-myth-ink-muted">Map Name</label>
                      <input
                        type="text"
                        value={newMapName}
                        onChange={(e) => setNewMapName(e.target.value)}
                        className="w-full rounded-md border border-myth-border bg-myth-surface px-4 py-2.5 text-myth-ink placeholder:text-myth-ink-faint focus:border-myth-accent focus:outline-none"
                        placeholder="e.g., Tavern Floor Plan, Dungeon Level 1"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-myth-ink-muted">Description</label>
                      <textarea
                        value={newMapDescription}
                        onChange={(e) => setNewMapDescription(e.target.value)}
                        className="w-full rounded-md border border-myth-border bg-myth-surface px-4 py-2.5 text-myth-ink placeholder:text-myth-ink-faint focus:border-myth-accent focus:outline-none"
                        rows={2}
                        placeholder="Optional description"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={creatingMap || !newMapName.trim()}
                        className="rounded-md bg-myth-accent px-4 py-2.5 text-center font-medium text-myth-accent-ink transition-colors hover:bg-myth-accent-hover disabled:opacity-50"
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
                        className="rounded-md border border-myth-border px-4 py-2.5 text-center font-medium text-myth-ink-muted transition-colors hover:border-myth-border-strong hover:text-myth-ink"
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
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-myth-accent"></div>
              </div>
            ) : maps.length === 0 ? (
              <EmptyState
                title="No maps yet"
                description={
                  userRole === 'ADMIN'
                    ? 'Create a map to visualize locations and track character positions.'
                    : 'The GM will create maps as the adventure unfolds.'
                }
                action={userRole === 'ADMIN' ? { label: 'Create Map', onClick: () => setShowCreateMap(true) } : undefined}
              />
            ) : (
              <div className="space-y-4">
                {maps.map((map: any) => (
                  <div key={map.id} className="rounded-md border border-myth-border p-4">
                    <div className="mb-4 flex items-start justify-between">
                      <div>
                        <div className="mb-1 flex items-center gap-2">
                          <h3 className="font-medium text-myth-ink">{map.name}</h3>
                          {map.isActive && (
                            <span className="rounded bg-myth-good/10 px-2 py-0.5 text-xs text-myth-good">Active</span>
                          )}
                        </div>
                        {map.description && <p className="text-sm text-myth-ink-muted">{map.description}</p>}
                        <div className="mt-2 flex items-center gap-4 font-mono text-xs text-myth-ink-faint">
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
                            className="rounded border border-myth-border px-3 py-1 text-xs text-myth-ink-muted hover:border-myth-border-strong hover:text-myth-ink"
                          >
                            Set Active
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Map Preview */}
                    <div className="overflow-hidden rounded-md border border-myth-border">
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

      <TavernNav campaignId={campaignId} variant="myth" />

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
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-2 sm:p-4">
          <div className="my-auto max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-myth-border bg-myth-surface-raised p-4 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.16)] sm:max-h-[90vh] sm:p-6">
            <h2 className="mb-4 font-display text-xl font-semibold text-myth-ink sm:text-2xl">Create New Character</h2>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-myth-border bg-myth-surface-raised p-4 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.16)] sm:p-6">
            <h2 className="mb-4 font-display text-xl font-semibold text-myth-ink sm:text-2xl">Delete Character?</h2>
            <p className="mb-6 text-sm text-myth-ink-muted sm:text-base">
              Are you sure you want to delete this character? This action cannot be undone.
              All associated actions and data will be permanently removed.
            </p>
            {deleteError && (
              <div className="mb-4 rounded-md border border-myth-danger/30 bg-myth-danger/10 px-4 py-3 text-sm text-myth-danger">
                {deleteError}
              </div>
            )}
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => {
                  setDeletingCharacterId(null)
                  setDeleteError('')
                }}
                className="min-h-[44px] flex-1 touch-manipulation rounded-md border border-myth-border px-4 py-2.5 text-center font-medium text-myth-ink-muted transition-colors hover:border-myth-border-strong hover:text-myth-ink"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteCharacter(deletingCharacterId)}
                className="min-h-[44px] flex-1 touch-manipulation rounded-md bg-red-700 px-4 py-2 text-white transition-colors hover:bg-red-800"
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
