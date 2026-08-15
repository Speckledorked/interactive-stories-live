// src/components/wiki/EntityBrowser.tsx
//
// The shared list/detail browser behind BOTH knowledge surfaces, because
// the campaign wiki was doing two unrelated jobs under one set of seven
// undifferentiated tabs:
//
//   /world  — the live entity browser. NPCs, Factions, Locations,
//             Threads: rows the world tick rewrites every turn, which
//             you consult to find out where things stand.
//   /wiki   — the Codex. Lore, Items, Custom entries and Rumors: written
//             material you read.
//
// Splitting them was safe to do because every relatedLinks entry
// wikiSync.ts actually writes points at a FACTION or a LOCATION — both
// on the /world side — so no cross-reference has to span the two
// surfaces. followRelatedLink needed no changes.
//
// Navigation on mobile is real push navigation through the URL rather
// than the scroll-to-top workaround this had before: selecting an entry
// pushes ?entry=<name>, so the device back button returns to the list
// instead of leaving the page. The list stays mounted (hidden) so its
// scroll position survives the round trip.

'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { authenticatedFetch, isAuthenticated, setLastCampaignId } from '@/lib/clientAuth'
import { pusherClient } from '@/lib/pusher'
import { BookOpen, Megaphone, Search } from 'lucide-react'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { SubNavTabs } from '@/components/ui/SubNavTabs'
import { EntityStatRow } from './EntityStatRow'
import { SectionHeader } from '@/components/ui/section-header'
import { groupWikiEntriesByCategory } from '@/lib/wikiCategoryGrouping'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ENTITY_ICONS, ENTITY_FALLBACK_ICON, type IconComponent } from '@/lib/ui/icons'
import { HEADER_OFFSET_SUBROW } from '@/components/tavern/headerOffset'

type WikiEntryType = 'NPC' | 'FACTION' | 'LOCATION' | 'CLOCK' | 'ITEM' | 'QUEST' | 'LORE' | 'CUSTOM'
// RUMORS isn't a WikiEntryType — it's a separate feed (offscreen
// PUBLIC/MIXED-visibility TimelineEvents, see /api/campaigns/[id]/rumors),
// not a WikiEntry row. Handled as a special-cased tab below.
type WikiTab = WikiEntryType | 'RUMORS'

// Covers every WikiEntryType, not just the ones with tabs — cross-reference
// links can point at LORE/CUSTOM entries that have no tab of their own.
export interface EntityBrowserTab {
  key: string
  label: string
  icon: IconComponent
}

export interface EntityBrowserProps {
  /** Tabs this surface exposes. The first is the default type. */
  tabs: EntityBrowserTab[]
  /** Page title in the header. */
  title: string
  /** One-line description under the header. */
  intro: string
  /** Route this browser lives at, e.g. `/campaigns/x/world`. */
  basePath: string
  /**
   * Types that belong to the OTHER surface. A `?type=` for one of these
   * is a legacy deep link from before the split and is redirected rather
   * than rendered as an empty tab.
   */
  redirectTypes?: Record<string, string>
}

export function EntityBrowser({ tabs, title, intro, basePath, redirectTypes }: EntityBrowserProps) {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const campaignId = params.id as string
  const initialType = (searchParams.get('type') as WikiTab) || (tabs[0].key as WikiTab)
  const initialSearch = searchParams.get('search') || ''
  // Deep-link support (e.g. the lobby's "World at a Glance" tiles): a
  // caller can land here with ?type=FACTION&entry=<name> and have that
  // specific entry auto-select once it loads, reusing the exact same
  // pendingEntryName resolution the in-page cross-reference links below
  // already do — loadEntries' initial-load effect doesn't care whether the
  // pending name came from a URL param or a click.
  const initialEntry = searchParams.get('entry')

  // A ?type= belonging to the other surface is a deep link from before
  // the Codex/World split (the lobby tiles, the sidebar, and anything a
  // player bookmarked). Redirect rather than render an empty tab.
  useEffect(() => {
    const requested = searchParams.get('type')
    const target = requested && redirectTypes?.[requested]
    if (!target) return
    const qs = new URLSearchParams(Array.from(searchParams.entries()))
    router.replace(`${target}?${qs.toString()}`)
  }, [searchParams, redirectTypes, router])

  const [entries, setEntries] = useState<any[]>([])
  const [rumors, setRumors] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedType, setSelectedType] = useState<WikiTab>(initialType)
  const [searchQuery, setSearchQuery] = useState(initialSearch)
  const [selectedEntry, setSelectedEntry] = useState<any>(null)
  // Set when a cross-reference link points at an entry on a different tab:
  // the tab switch triggers a reload, and the entry can only be selected
  // once that reload lands.
  const [pendingEntryName, setPendingEntryName] = useState<string | null>(initialEntry)
  // #172/#181: a tab switch and a `scene:resolved` live-update can both
  // trigger loadEntries() close together — without a way to tell an
  // in-flight call it's been superseded, whichever fetch settles last wins,
  // which could show the wrong tab's entries after a fast tab switch.
  const loadRequestIdRef = useRef(0)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    loadEntries()
  }, [campaignId, selectedType])

  // Live-update wiki when a scene resolves (new NPCs, locations, etc. get registered)
  useEffect(() => {
    if (!pusherClient) return

    const channel = pusherClient.subscribe(`campaign-${campaignId}`)

    channel.bind('scene:resolved', () => {
      loadEntries()
    })

    return () => {
      if (pusherClient) {
        pusherClient.unsubscribe(`campaign-${campaignId}`)
      }
    }
  }, [campaignId, selectedType])

  const loadEntries = async () => {
    const requestId = ++loadRequestIdRef.current
    const isStale = () => requestId !== loadRequestIdRef.current

    setLoading(true)
    try {
      if (selectedType === 'RUMORS') {
        const response = await authenticatedFetch(`/api/campaigns/${campaignId}/rumors`)
        if (!response.ok) throw new Error('Failed to load rumors')
        const data = await response.json()
        if (isStale()) return
        setRumors(data.rumors || [])
        setLastCampaignId(campaignId)
        return
      }

      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/wiki?type=${selectedType}`
      )
      if (!response.ok) throw new Error('Failed to load wiki entries')

      const data = await response.json()
      if (isStale()) return
      const loaded = data.entries || []
      setEntries(loaded)
      if (pendingEntryName) {
        // A related-entry link asked for this specific page. It may not be
        // here — fog of war can hide the target, or the link can name an
        // entry that no longer exists — in which case the tab still
        // switches and nothing is selected.
        const target = loaded.find(
          (e: any) => e.name.toLowerCase() === pendingEntryName.toLowerCase()
        )
        if (target) setSelectedEntry(target)
        setPendingEntryName(null)
      }
      setLastCampaignId(campaignId)
    } catch (err) {
      if (!isStale()) setError(err instanceof Error ? err.message : 'Failed to load wiki')
    } finally {
      if (!isStale()) setLoading(false)
    }
  }

  const filteredEntries = entries.filter(entry =>
    entry.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    entry.summary.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Grouped for display — collapses to a single unlabeled group when every
  // visible entry shares a category (or none do), so a small/uniform list
  // doesn't grow a redundant one-item header.
  const entryGroups = groupWikiEntriesByCategory(filteredEntries, selectedType)
  const showCategoryHeaders = entryGroups.length > 1

  const filteredRumors = rumors.filter(rumor =>
    rumor.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (rumor.summary || '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  // #169: below the lg breakpoint the list and detail panes stack instead
  // of sitting side by side, so selecting an entry used to leave its detail
  // view below the rest of the (still-visible) list — the reader had to
  // scroll past every other entry to reach the one they picked. Scrolling
  // to top on selection is what makes the detail pane read as "opened",
  // matching the list/detail push navigation pattern; only doing this
  // below lg leaves the desktop split-pane (both panes always visible,
  // nothing to "open") untouched.
  // Selecting an entry pushes it into the URL rather than only into
  // component state. That's what makes the device back button return to
  // the list on a phone — the previous version scrolled to the top and
  // left the browser's history untouched, so Back exited the page
  // entirely. The list stays mounted (hidden, not unmounted) so its
  // scroll position survives the round trip.
  const selectEntry = (entry: any) => {
    setSelectedEntry(entry)
    const qs = new URLSearchParams()
    qs.set('type', selectedType)
    qs.set('entry', entry.name)
    if (searchQuery) qs.set('search', searchQuery)
    router.push(`${basePath}?${qs.toString()}`, { scroll: false })
  }

  const clearEntry = () => {
    setSelectedEntry(null)
    const qs = new URLSearchParams()
    qs.set('type', selectedType)
    if (searchQuery) qs.set('search', searchQuery)
    router.replace(`${basePath}?${qs.toString()}`, { scroll: false })
  }

  // Keep state in step with history: popping back to a URL without
  // ?entry= has to close the detail pane, or Back would appear to do
  // nothing.
  const urlEntry = searchParams.get('entry')
  useEffect(() => {
    if (!urlEntry && selectedEntry) setSelectedEntry(null)
  }, [urlEntry]) // eslint-disable-line react-hooks/exhaustive-deps

  // Follow a cross-reference. Same-tab links resolve immediately from the
  // already-loaded list; anything else switches tabs and defers selection
  // to the reload (see pendingEntryName).
  const followRelatedLink = (link: { id: string; type: WikiEntryType }) => {
    if (link.type === selectedType) {
      const target = entries.find(e => e.name.toLowerCase() === link.id.toLowerCase())
      if (target) selectEntry(target)
      return
    }
    setPendingEntryName(link.id)
    setSelectedEntry(null)
    setSelectedType(link.type)
  }

  const getImportanceColor = (importance: string) => {
    switch (importance) {
      case 'critical': return 'text-myth-danger bg-myth-danger/10'
      case 'major': return 'text-myth-warn bg-myth-warn/10'
      case 'normal': return 'text-myth-info bg-myth-info/10'
      default: return 'text-myth-ink-faint bg-myth-surface-sunken'
    }
  }

  return (
    <TavernPage background="myth">
      <TavernHeader
        backHref={`/campaigns/${campaignId}`}
        title={title}
        campaignId={campaignId}
        variant="myth"
        subrow={
          <nav className="max-w-6xl mx-auto px-4 flex items-center gap-1 overflow-x-auto text-sm border-t border-myth-border pt-2 pb-0">
            <SubNavTabs
              tabs={tabs}
              activeKey={selectedType}
              onSelect={(key) => setSelectedType(key as WikiTab)}
              itemClassName="whitespace-nowrap flex-shrink-0"
              variant="myth"
            />
          </nav>
        }
      />

      <main className={`max-w-6xl mx-auto px-4 ${HEADER_OFFSET_SUBROW} pb-28`}>
        <p className="mb-6 text-sm text-myth-ink-faint">{intro}</p>

        {/* Search */}
        <div className="relative mb-6">
          <Input
            wrapperClassName="w-full" className="pl-10"
            type="text"
            /* Names the surface being searched, not the table behind it —
               "wiki entries" was left over from before the split and read
               wrong on a page titled World. */
            placeholder={`Search ${title}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-myth-ink-faint" />
        </div>

      {/* Rumors — a flat feed, not entity detail, so it gets its own
          single-column narrative layout instead of the list+detail split
          below (see docs/design-system.md: this is content meant to be
          read, not reference material). */}
      {selectedType === 'RUMORS' ? (
        <div>
          <SectionHeader
            as="h2"
            title={`Rumors (${filteredRumors.length})`}
            description="Word of things happening elsewhere in the world — not witnessed firsthand, just heard about."
          />
          <div className="mt-6">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-myth-accent" />
            </div>
          ) : filteredRumors.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-myth-ink-faint">
                {searchQuery ? 'No rumors match your search' : 'No rumors yet'}
              </p>
              <p className="mt-2 text-xs text-myth-ink-faint">
                Rumors surface as events happen offscreen, elsewhere in the world
              </p>
            </div>
          ) : (
            <div className="divide-y divide-myth-border">
              {filteredRumors.map((rumor: any) => (
                <div key={rumor.id} className="py-4 first:pt-0">
                  <div className="mb-1.5 flex items-start justify-between">
                    <h4 className="text-sm font-semibold text-myth-ink">{rumor.title}</h4>
                    {rumor.turnNumber && (
                      <span className="ml-2 flex-shrink-0 text-xs text-myth-ink-faint">Turn {rumor.turnNumber}</span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-myth-ink-muted">{rumor.summary}</p>
                </div>
              ))}
            </div>
          )}
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Entry List — reference content: clicking a row selects it. Below
            lg, hidden (not unmounted, so scroll position survives) once an
            entry is selected — see #169 / selectEntry above — and always
            visible at lg+ where it sits beside the detail pane. */}
        <div className={`lg:col-span-1 ${selectedEntry ? 'hidden lg:block' : 'block'}`}>
          <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
            <h3 className="mb-3 text-sm font-bold text-myth-ink-faint">
              {tabs.find(t => t.key === selectedType)?.label} ({filteredEntries.length})
            </h3>

            {loading ? (
              <div className="flex justify-center py-8">
                <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-myth-accent" />
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-myth-ink-faint">
                  {searchQuery ? 'No entries match your search' : 'No entries yet'}
                </p>
                <p className="mt-2 text-xs text-myth-ink-faint">
                  Entries are automatically created as the story unfolds
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {entryGroups.map((group) => (
                  <div key={group.label}>
                    {showCategoryHeaders && (
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-myth-ink-faint">
                        {group.label} <span className="font-normal normal-case text-myth-ink-faint/70">({group.entries.length})</span>
                      </h4>
                    )}
                    <div className="space-y-2">
                      {group.entries.map((entry: any) => (
                        <button
                          key={entry.id}
                          onClick={() => selectEntry(entry)}
                          className={`w-full text-left p-3 rounded-lg border transition-colors ${
                            selectedEntry?.id === entry.id
                              ? 'border-myth-accent bg-myth-accent/5'
                              : 'border-myth-border hover:border-myth-border-strong hover:bg-myth-surface-sunken'
                          }`}
                        >
                          <div className="mb-1.5 flex items-start justify-between">
                            <h4 className="text-sm font-semibold text-myth-ink">{entry.name}</h4>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getImportanceColor(entry.importance)}`}>
                              {entry.importance}
                            </span>
                          </div>
                          <p className="line-clamp-2 text-xs leading-relaxed text-myth-ink-muted">{entry.summary}</p>
                          {/* Live simulation state, present only on the
                              /world types the API enriches. This is the
                              actual difference between a World card and a
                              Codex card — the prose above is the same on
                              both. */}
                          {entry.stats && <EntityStatRow stats={entry.stats} />}
                          {entry.lastSeenTurn && (
                            <p className="mt-2 flex items-center gap-1 text-xs text-myth-ink-faint">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Last seen: Turn {entry.lastSeenTurn}
                            </p>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Entry Detail — narrative content: lore prose, no card chrome.
            Below lg, hidden until an entry is selected (see #169); always
            visible at lg+ where it shows the placeholder when nothing's
            selected. */}
        <div className={`lg:col-span-2 ${selectedEntry ? 'block' : 'hidden lg:block'}`}>
          {selectedEntry ? (
            <div>
              <Button
                variant="ghost" size="sm" className="-ml-3 mb-4 lg:hidden"
                onClick={clearEntry}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to {tabs.find(t => t.key === selectedType)?.label}
              </Button>

              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className="font-display text-2xl font-semibold text-myth-ink">{selectedEntry.name}</h2>
                  {selectedEntry.aliases && selectedEntry.aliases.length > 0 && (
                    <p className="mt-1 text-sm text-myth-ink-faint">
                      Also known as: {selectedEntry.aliases.join(', ')}
                    </p>
                  )}
                </div>
                <span className={`rounded px-3 py-1 text-sm ${getImportanceColor(selectedEntry.importance)}`}>
                  {selectedEntry.importance}
                </span>
              </div>

              {/* Current state, repeated from the list card on purpose:
                  the detail pane replaces the list at mobile widths, so
                  without this the numbers vanish the moment you open the
                  entity you wanted to read about. */}
              {selectedEntry.stats && (
                <div className="mb-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-myth-ink-faint">Current State</h3>
                  <EntityStatRow stats={selectedEntry.stats} />
                </div>
              )}

              {/* Per-viewer, not campaign-wide: drawn from the logged-in
                  player's own hidden trust/tension/respect/fear with this
                  NPC (see npcRelationship.ts) — two players looking at the
                  same NPC can see different labels here, same as the
                  character sheet's own Reputation section. Numbers never
                  leave the server; only these diegetic labels do. */}
              {selectedEntry.entryType === 'NPC' && selectedEntry.myStanding && selectedEntry.myStanding.length > 0 && (
                <div className="mb-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-myth-ink-faint">Your Standing</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedEntry.myStanding.map((label: string, i: number) => (
                      <span
                        key={i}
                        className={`rounded-full border px-3 py-1.5 text-sm ${
                          label.startsWith('Fear') || label.includes('hostile') || label.startsWith('Distrust') || label.startsWith('Dismiss')
                            ? 'border-myth-danger/30 bg-myth-danger/10 text-myth-danger'
                            : 'border-myth-border bg-myth-surface-sunken text-myth-ink-muted'
                        }`}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selectedEntry.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- no next/image remote-host config exists yet
                <img
                  src={selectedEntry.imageUrl}
                  alt={selectedEntry.name}
                  className="mb-4 h-48 w-full rounded-lg object-cover"
                />
              )}

              <div className="mb-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-myth-ink-faint">Summary</h3>
                <p className="leading-relaxed text-myth-ink-muted">{selectedEntry.summary}</p>
              </div>

              <div className="mb-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-myth-ink-faint">Details</h3>
                <p className="whitespace-pre-wrap leading-relaxed text-myth-ink-muted">{selectedEntry.description}</p>
              </div>

              {selectedEntry.tags && selectedEntry.tags.length > 0 && (
                <div className="mb-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-myth-ink-faint">Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedEntry.tags.map((tag: string, i: number) => (
                      <span key={i} className="rounded-lg border border-myth-border px-3 py-1 text-xs font-medium text-myth-ink-muted">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selectedEntry.relatedEntries && selectedEntry.relatedEntries.length > 0 && (
                <div className="mb-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-myth-ink-faint">Connections</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedEntry.relatedEntries.map((link: any, i: number) => (
                      <Button
                        variant="secondary" size="sm"
                        key={i}
                        onClick={() => followRelatedLink(link)}
                      >
                        {(() => {
                          const Icon = ENTITY_ICONS[link.type as WikiEntryType] ?? ENTITY_FALLBACK_ICON
                          return <Icon className="mr-1 inline h-3.5 w-3.5 align-[-0.15em]" />
                        })()}
                        <span className="font-medium text-myth-ink">{link.id}</span>
                        <span className="text-myth-ink-faint"> — {link.relationship}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {selectedEntry.changelog && selectedEntry.changelog.length > 0 && (
                <div className="mt-6 border-t border-myth-border pt-6">
                  <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-myth-ink-faint">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    History
                  </h3>
                  <div className="divide-y divide-myth-border">
                    {selectedEntry.changelog.map((change: any, i: number) => (
                      <div key={i} className="py-2 text-sm first:pt-0">
                        <span className="font-medium text-myth-ink">Turn {change.turn}:</span>{' '}
                        <span className="text-myth-ink-muted">{change.change}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-6 flex items-center justify-between border-t border-myth-border pt-4 text-xs text-myth-ink-faint">
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Created {new Date(selectedEntry.createdAt).toLocaleDateString()}
                </span>
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Updated {new Date(selectedEntry.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-myth-border px-5 py-12 text-center">
              <BookOpen className="mx-auto mb-4 h-12 w-12 text-myth-ink-faint" />
              <p className="text-myth-ink-muted">Select an entry to view details</p>
            </div>
          )}
        </div>
      </div>
      )}
      </main>

      <TavernNav campaignId={campaignId} variant="myth" />
    </TavernPage>
  )
}
