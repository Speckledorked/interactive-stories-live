// src/app/campaigns/[id]/wiki/page.tsx
// Campaign wiki - knowledge base for NPCs, factions, locations, etc.

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { authenticatedFetch, isAuthenticated, setLastCampaignId } from '@/lib/clientAuth'
import { pusherClient } from '@/lib/pusher'
import { Search } from 'lucide-react'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { SubNavTabs } from '@/components/ui/SubNavTabs'
import { SectionHeader } from '@/components/ui/section-header'
import { groupWikiEntriesByCategory } from '@/lib/wikiCategoryGrouping'

type WikiEntryType = 'NPC' | 'FACTION' | 'LOCATION' | 'CLOCK' | 'ITEM' | 'QUEST' | 'LORE' | 'CUSTOM'
// RUMORS isn't a WikiEntryType — it's a separate feed (offscreen
// PUBLIC/MIXED-visibility TimelineEvents, see /api/campaigns/[id]/rumors),
// not a WikiEntry row. Handled as a special-cased tab below.
type WikiTab = WikiEntryType | 'RUMORS'

// Covers every WikiEntryType, not just the ones with tabs — cross-reference
// links can point at LORE/CUSTOM entries that have no tab of their own.
const ENTRY_TYPE_ICONS: Record<WikiEntryType, string> = {
  NPC: '👤',
  FACTION: '⚔️',
  LOCATION: '🏛️',
  CLOCK: '⏰',
  ITEM: '🎒',
  QUEST: '📜',
  LORE: '📖',
  CUSTOM: '🔖',
}

export default function WikiPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const campaignId = params.id as string
  const initialType = (searchParams.get('type') as WikiTab) || 'NPC'
  const initialSearch = searchParams.get('search') || ''
  // Deep-link support (e.g. the lobby's "World at a Glance" tiles): a
  // caller can land here with ?type=FACTION&entry=<name> and have that
  // specific entry auto-select once it loads, reusing the exact same
  // pendingEntryName resolution the in-page cross-reference links below
  // already do — loadEntries' initial-load effect doesn't care whether the
  // pending name came from a URL param or a click.
  const initialEntry = searchParams.get('entry')

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
    setLoading(true)
    try {
      if (selectedType === 'RUMORS') {
        const response = await authenticatedFetch(`/api/campaigns/${campaignId}/rumors`)
        if (!response.ok) throw new Error('Failed to load rumors')
        const data = await response.json()
        setRumors(data.rumors || [])
        setLastCampaignId(campaignId)
        return
      }

      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/wiki?type=${selectedType}`
      )
      if (!response.ok) throw new Error('Failed to load wiki entries')

      const data = await response.json()
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
      setError(err instanceof Error ? err.message : 'Failed to load wiki')
    } finally {
      setLoading(false)
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

  const tabs: { key: WikiTab; label: string; icon: string }[] = [
    { key: 'NPC', label: 'NPCs', icon: '👤' },
    { key: 'FACTION', label: 'Factions', icon: '⚔️' },
    { key: 'LOCATION', label: 'Locations', icon: '🏛️' },
    { key: 'CLOCK', label: 'Threads', icon: '⏰' },
    { key: 'ITEM', label: 'Items', icon: '🎒' },
    { key: 'QUEST', label: 'Quests', icon: '📜' },
    { key: 'RUMORS', label: 'Rumors', icon: '🗣️' },
  ]

  // #169: below the lg breakpoint the list and detail panes stack instead
  // of sitting side by side, so selecting an entry used to leave its detail
  // view below the rest of the (still-visible) list — the reader had to
  // scroll past every other entry to reach the one they picked. Scrolling
  // to top on selection is what makes the detail pane read as "opened",
  // matching the list/detail push navigation pattern; only doing this
  // below lg leaves the desktop split-pane (both panes always visible,
  // nothing to "open") untouched.
  const MOBILE_BREAKPOINT_PX = 1024 // Tailwind's `lg`
  const selectEntry = (entry: any) => {
    setSelectedEntry(entry)
    if (typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT_PX) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

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
        title="Campaign Wiki"
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

      <main className="max-w-6xl mx-auto px-4 pt-28 pb-28">
        <p className="mb-6 text-sm text-myth-ink-faint">A living knowledge base updated by MythOS</p>

        {/* Search */}
        <div className="relative mb-6">
          <input
            type="text"
            placeholder="Search wiki entries..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-myth-border bg-myth-surface px-4 py-2.5 pl-10 text-myth-ink placeholder:text-myth-ink-faint focus:border-myth-accent focus:outline-none"
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
              <button
                onClick={() => setSelectedEntry(null)}
                className="mb-4 flex items-center gap-1 text-sm font-medium text-myth-ink-muted hover:text-myth-ink lg:hidden"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to {tabs.find(t => t.key === selectedType)?.label}
              </button>

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
                      <button
                        key={i}
                        onClick={() => followRelatedLink(link)}
                        className="rounded-lg border border-myth-border px-3 py-1.5 text-left text-xs transition-colors hover:border-myth-border-strong hover:bg-myth-surface-sunken"
                      >
                        <span className="mr-1">{ENTRY_TYPE_ICONS[link.type as WikiEntryType] || '🔗'}</span>
                        <span className="font-medium text-myth-ink">{link.id}</span>
                        <span className="text-myth-ink-faint"> — {link.relationship}</span>
                      </button>
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
              <div className="mb-4 text-6xl">📖</div>
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
