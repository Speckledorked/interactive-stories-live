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
import { PlayerMapViewer } from '@/components/maps/PlayerMapViewer'
import InviteModal from '@/components/campaigns/InviteModal'
import { Home, Scroll, MessageSquare, StickyNote, Map as MapIcon } from 'lucide-react'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionHeader } from '@/components/ui/section-header'
import { CampaignHero } from '@/components/campaigns/lobby/CampaignHero'
import { CharacterRoster } from '@/components/campaigns/lobby/CharacterRoster'
import { PlayersPanel } from '@/components/campaigns/lobby/PlayersPanel'
import { WorldChronicle } from '@/components/campaigns/lobby/WorldChronicle'
import { CurrentObjective } from '@/components/campaigns/lobby/CurrentObjective'
import { WorldGlance } from '@/components/campaigns/lobby/WorldGlance'
import type { ChronicleGlance } from '@/lib/game/chronicleTypes'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tabs } from '@/components/ui/tabs'
import { Timeline, TimelineItem } from '@/components/ui/timeline'
import { QuickAccess } from '@/components/campaigns/lobby/QuickAccess'
import { HEADER_OFFSET_SUBROW } from '@/components/tavern/headerOffset'

interface CampaignData {
  campaign: any
  userRole: 'ADMIN' | 'PLAYER'
}

const VALID_TABS = ['overview', 'chat', 'notes', 'maps', 'progression'] as const
type LobbyTab = (typeof VALID_TABS)[number]

// The lobby shows a window onto the away-recap, not the whole thing —
// an unbounded list on a phone pushes everything below it off the page.
const RECENT_EVENT_LIMIT = 5

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
  const [logsHasMore, setLogsHasMore] = useState(false)
  const [loadingEarlierLogs, setLoadingEarlierLogs] = useState(false)
  // Campaign-wide scene count from the server (#234) — the milestone
  // progress bar needs the real total, not just however many entries
  // happen to be loaded into campaignLogs at the moment.
  const [logsSceneCount, setLogsSceneCount] = useState(0)
  const [regeneratingLogs, setRegeneratingLogs] = useState(false)
  const [regenerateLogsResult, setRegenerateLogsResult] = useState('')
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
        setLogsHasMore(!!data.hasMore)
        setLogsSceneCount(data.sceneCount || 0)
      }
    } catch (err) {
      console.error('Failed to load campaign logs:', err)
    } finally {
      setLogsLoading(false)
    }
  }

  // #234: fetches the page of Story Log entries just older than whatever's
  // currently loaded (cursor = the oldest loaded entry's id) and prepends
  // them — the log renders oldest-first, so "earlier" entries belong above
  // what's already on screen.
  const loadEarlierLogs = async () => {
    const oldestLoaded = campaignLogs[0]
    if (!oldestLoaded || loadingEarlierLogs) return
    setLoadingEarlierLogs(true)
    try {
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/logs?before=${encodeURIComponent(oldestLoaded.id)}`
      )
      if (response.ok) {
        const data = await response.json()
        setCampaignLogs(prev => [...(data.logs || []), ...prev])
        setLogsHasMore(!!data.hasMore)
      }
    } catch (err) {
      console.error('Failed to load earlier campaign logs:', err)
    } finally {
      setLoadingEarlierLogs(false)
    }
  }

  const handleRegenerateLogs = async () => {
    setRegeneratingLogs(true)
    setRegenerateLogsResult('')
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/logs/regenerate`, {
        method: 'POST'
      })
      const result = await response.json()
      if (response.ok) {
        setRegenerateLogsResult(
          (result.consolidated > 0 ? `Merged ${result.consolidated} duplicate ${result.consolidated === 1 ? 'entry' : 'entries'}. ` : '') +
          `Regenerated ${result.regenerated} ${result.regenerated === 1 ? 'entry' : 'entries'}` +
          (result.failed > 0 ? `, ${result.failed} failed` : '') +
          (result.remaining > 0 ? ` — ${result.remaining} more left, run again to continue` : '')
        )
        await loadCampaignLogs()
      } else {
        setRegenerateLogsResult(result.error || 'Failed to regenerate entries')
      }
    } catch (err) {
      setRegenerateLogsResult('Failed to regenerate entries')
    } finally {
      setRegeneratingLogs(false)
    }
  }

  if (loading) {
    return (
      <TavernPage background="myth">
        <TavernHeader backHref="/campaigns" title="Loading…" campaignId={campaignId} variant="myth" minimalHeaderAtDesktop />
        <main className={`flex justify-center max-w-6xl mx-auto px-4 ${HEADER_OFFSET_SUBROW} pb-16`}>
          <div className="h-16 w-16 animate-spin rounded-full border-b-2 border-myth-accent" />
        </main>
      </TavernPage>
    )
  }

  if (error || !data) {
    return (
      <TavernPage background="myth">
        <TavernHeader backHref="/campaigns" title="Campaign" campaignId={campaignId} variant="myth" />
        <main className={`max-w-2xl mx-auto px-4 ${HEADER_OFFSET_SUBROW} pb-16`}>
          <div className="rounded-lg border border-myth-border bg-myth-surface p-6">
            <p className="text-myth-danger">{error || 'Campaign not found'}</p>
            <Link href="/campaigns" className="mt-4 inline-block text-myth-ink-muted hover:text-myth-ink hover:underline">
              Back to campaigns
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


  return (
    <TavernPage background="myth">
      <TavernHeader
        backHref="/campaigns"
        title={campaign.title}
        campaignId={campaignId}
        isAdmin={userRole === 'ADMIN'}
        variant="myth"
        minimalHeaderAtDesktop
        subrow={
          // lg:hidden — TavernSidebar already lists all five of these as
          // nav items, so this tab strip is redundant once the sidebar is
          // visible. Scoped to this file only: wiki/story pages' subrows
          // have no sidebar equivalent and must keep rendering at every
          // width (see TavernHeader's minimalHeaderAtDesktop doc comment).
          <Tabs
            aria-label="Campaign sections"
            value={activeTab}
            onChange={(key) => setActiveTab(key as any)}
            className="max-w-6xl mx-auto px-4 border-t border-b-0 border-myth-border pt-2 lg:hidden"
            items={[
              { key: 'overview', label: 'Overview', icon: Home },
              { key: 'progression', label: 'Story Log', icon: Scroll },
              { key: 'chat', label: 'Chat', icon: MessageSquare },
              { key: 'notes', label: 'Notes', icon: StickyNote },
              { key: 'maps', label: 'Maps', icon: MapIcon },
            ]}
          />
        }
      />

      <main className={`max-w-6xl mx-auto px-4 ${HEADER_OFFSET_SUBROW} pb-28`}>
        {/* World-seeding lock: canon lore is still being imported and the
            world rebuilt from it — play opens when this clears. */}
        {worldSeeding && (
          <div className="mb-6 flex items-center gap-4 rounded-lg border border-myth-info/30 bg-myth-info/10 px-5 py-4">
            <Spinner className="h-8 w-8 flex-shrink-0" />
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

        <CampaignHero
          campaignId={campaignId}
          title={campaign.title}
          description={campaign.description}
          universe={campaign.universe}
          turnNumber={campaign.worldMeta?.currentTurnNumber || 0}
          inGameDate={campaign.worldMeta?.currentInGameDate || 'Day 1'}
          heroImageUrl={campaign.heroImageStatus === 'READY' ? campaign.heroImageUrl : null}
          heroImageStatus={campaign.heroImageStatus}
          isAdmin={userRole === 'ADMIN'}
          hasCharacter={userCharacters.length > 0}
          onCreateCharacter={() => setShowCreateCharacter(true)}
        />

      {/* Overview Tab.
          Vertical order at 390px is chosen by what a returning player
          needs first: what should I do (Current Objective) -> what
          changed (Glance, Chronicle, Timeline) -> where do I go (Quick
          Access) -> who's here (roster). The roster and player list are
          reference content and sit below the world state rather than
          above it, which is the opposite of the pre-redesign order. */}
      {activeTab === 'overview' && (
      <div className="space-y-6">
        <CurrentObjective campaignId={campaignId} />

        <WorldGlance
          campaignId={campaignId}
          glance={(campaign.worldMeta?.chronicleGlance as ChronicleGlance | null) ?? null}
          turnNumber={campaign.worldMeta?.currentTurnNumber || 0}
        />

        <WorldChronicle
          campaignId={campaignId}
          narration={campaign.worldMeta?.chronicleNarration ?? null}
          hoursSinceWorldTurn={campaign.worldMeta?.hoursSinceWorldTurn ?? null}
          worldTurnHours={campaign.worldMeta?.worldTurnHours ?? null}
        />

        {/* World Timeline — offscreen world-turn fallout the player missed
            since they last opened this lobby, on the shared dotted rail so
            it reads as a sequence of turns rather than a run-on paragraph.
            Not persisted as dismissed (it naturally won't reappear once
            lastViewedAt advances past these events).

            The mockup shows this and a separate "Recent Events" list, but
            both are the same TimelineEvent feed — rendering it twice would
            be two views of one thing rather than two things. */}
        {awayRecap && awayRecap.events.length > 0 && (
          <div className="space-y-3">
            <SectionHeader as="h2" title="World Timeline" description={`While you were away (${awayRecap.awayLabel})`} />
            <Timeline>
              {awayRecap.events.slice(0, RECENT_EVENT_LIMIT).map((e, i, shown) => (
                <TimelineItem
                  key={e.id}
                  isLast={i === shown.length - 1}
                  tone={i === 0 ? 'accent' : 'muted'}
                >
                  <p className="text-sm font-medium text-myth-ink">{e.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-myth-ink-muted">{e.summary}</p>
                </TimelineItem>
              ))}
            </Timeline>
            <Link
              href={`/campaigns/${campaignId}?tab=progression`}
              className="inline-flex min-h-[44px] items-center text-sm text-myth-ink-faint hover:text-myth-ink hover:underline"
            >
              {awayRecap.events.length > RECENT_EVENT_LIMIT
                ? `See all ${awayRecap.events.length} in the story log`
                : 'See everything that\u2019s happened'}
            </Link>
          </div>
        )}

        <QuickAccess campaignId={campaignId} />

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

        <p className="pt-2 text-center text-sm italic text-myth-ink-faint">
          The world does not wait. It lives, it breathes, it remembers.
        </p>
      </div>
      )}

      {/* Progression/Story Log Tab */}
      {activeTab === 'progression' && data && (
        <div className="mx-auto max-w-6xl">
          <SectionHeader
            title="Campaign Story Log"
            description="A chronicle of your adventure, updated after each scene"
            action={
              userRole === 'ADMIN' && campaignLogs.length > 0 ? (
                <div className="flex flex-col items-end gap-1">
                  <Button
                    variant="secondary" size="sm"
                    onClick={handleRegenerateLogs}
                    disabled={regeneratingLogs}
                    title="Re-summarize existing entries with a fresh AI pass"
                  >
                    {regeneratingLogs ? 'Regenerating…' : 'Regenerate All'}
                  </Button>
                  {regenerateLogsResult && (
                    <p className="max-w-xs text-right text-xs text-myth-ink-faint">{regenerateLogsResult}</p>
                  )}
                </div>
              ) : undefined
            }
          />
          <div className="mt-6">
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
                {/* Timeline Bar - MILESTONE_INTERVAL must match
                    CAMPAIGN_MILESTONE_INTERVAL in lib/game/campaignMilestone.ts,
                    which is what actually generates a "milestone" Story Log
                    entry + notifies the party every N scenes. Only counts
                    entryType 'scene' rows, so a milestone entry itself
                    (entryType 'milestone') doesn't inflate the count it's
                    measured against.
                    #234: sourced from logsSceneCount (a real campaign-wide
                    count from the server), not campaignLogs.filter(...).length
                    — campaignLogs is now just whatever page(s) happen to be
                    loaded, which would silently undercount once pagination
                    made "all logs are always loaded" no longer true. */}
                {(() => {
                  const MILESTONE_INTERVAL = 20
                  const sceneCount = logsSceneCount
                  const nextMilestone = Math.ceil((sceneCount + 1) / MILESTONE_INTERVAL) * MILESTONE_INTERVAL
                  const cycleProgress = (sceneCount % MILESTONE_INTERVAL) / MILESTONE_INTERVAL * 100
                  return (
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
                          style={{ width: `${cycleProgress}%` }}
                        />
                      </div>
                      <div className="mt-2 flex justify-between text-xs text-myth-ink-faint">
                        <span>{sceneCount} scenes completed</span>
                        <span>Milestone at {nextMilestone} scenes</span>
                      </div>
                    </div>
                  )
                })()}

                {/* #234: only the most recent page of entries loads by
                    default — this pulls in the next-older page, prepended
                    above whatever's already showing, matching the log's
                    own oldest-first reading order. */}
                {logsHasMore && (
                  <div className="mb-4 flex justify-center">
                    <Button
                      variant="secondary" size="sm"
                      onClick={loadEarlierLogs}
                      disabled={loadingEarlierLogs}
                    >
                      {loadingEarlierLogs ? 'Loading…' : 'Load earlier entries'}
                    </Button>
                  </div>
                )}

                {/* Log Entries — flowing/divided, not individually boxed: this
                    is narrative content meant to be read, not a list of
                    actionable rows (see docs/design-system.md). */}
                <div className="divide-y divide-myth-border">
                  {campaignLogs.map((log: any) => (
                    <div key={log.id} className="py-4 first:pt-0">
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
          <SectionHeader
            title="Campaign Maps"
            action={
              // Any player can create maps — shared table content, not a
              // GM power (there is no human GM in this product).
              <Button
                variant="ghost" size="sm" className="-mr-3"
                onClick={() => setShowCreateMap(true)}
              >
                + Create Map
              </Button>
            }
          />
          <div className="mt-6">
            {/* Create Map Form */}
            {showCreateMap && (
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
                      <Input
                        type="text"
                        value={newMapName}
                        onChange={(e) => setNewMapName(e.target.value)}
                        placeholder="e.g., Tavern Floor Plan, Dungeon Level 1"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-myth-ink-muted">Description</label>
                      <Textarea
                        value={newMapDescription}
                        onChange={(e) => setNewMapDescription(e.target.value)}
                        rows={2}
                        placeholder="Optional description"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        type="submit"
                        disabled={creatingMap || !newMapName.trim()}
                      >
                        {creatingMap ? 'Creating...' : 'Create Map'}
                      </Button>
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => {
                          setShowCreateMap(false)
                          setNewMapName('')
                          setNewMapDescription('')
                        }}
                      >
                        Cancel
                      </Button>
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
                description="Create a map to visualize locations and track character positions."
                action={{ label: 'Create Map', onClick: () => setShowCreateMap(true) }}
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
                          <Button
                            variant="secondary" size="sm"
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
                          >
                            Set Active
                          </Button>
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
              <Button
                variant="secondary" fullWidth
                onClick={() => {
                  setDeletingCharacterId(null)
                  setDeleteError('')
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger" fullWidth
                onClick={() => handleDeleteCharacter(deletingCharacterId)}
              >
                Delete
              </Button>
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
