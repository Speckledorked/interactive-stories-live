// src/app/campaigns/[id]/wiki/page.tsx
// Campaign wiki - knowledge base for NPCs, factions, locations, etc.

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'
import { pusherClient } from '@/lib/pusher'
import { Search, BookOpen } from 'lucide-react'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { TavernEmptyState, TavernSpinner } from '@/components/tavern/ui'

type WikiEntryType = 'NPC' | 'FACTION' | 'LOCATION' | 'CLOCK' | 'ITEM' | 'QUEST' | 'LORE' | 'CUSTOM'

export default function WikiPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const campaignId = params.id as string
  const initialType = (searchParams.get('type') as WikiEntryType) || 'NPC'
  const initialSearch = searchParams.get('search') || ''

  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedType, setSelectedType] = useState<WikiEntryType>(initialType)
  const [searchQuery, setSearchQuery] = useState(initialSearch)
  const [selectedEntry, setSelectedEntry] = useState<any>(null)

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
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/wiki?type=${selectedType}`
      )
      if (!response.ok) throw new Error('Failed to load wiki entries')

      const data = await response.json()
      setEntries(data.entries || [])
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

  const tabs: { key: WikiEntryType; label: string; icon: string }[] = [
    { key: 'NPC', label: 'NPCs', icon: '👤' },
    { key: 'FACTION', label: 'Factions', icon: '⚔️' },
    { key: 'LOCATION', label: 'Locations', icon: '🏛️' },
    { key: 'CLOCK', label: 'Clocks', icon: '⏰' },
    { key: 'ITEM', label: 'Items', icon: '🎒' },
    { key: 'QUEST', label: 'Quests', icon: '📜' },
    { key: 'LORE', label: 'Lore', icon: '📚' },
  ]

  const getImportanceColor = (importance: string) => {
    switch (importance) {
      case 'critical': return 'text-wine-400 bg-wine-800/30'
      case 'major': return 'text-ember-300 bg-ember-900/30'
      case 'normal': return 'text-ember-200 bg-ember-900/20'
      default: return 'text-ember-400/60 bg-black/30'
    }
  }

  return (
    <TavernPage>
      <TavernHeader
        backHref={`/campaigns/${campaignId}`}
        title="Campaign Wiki"
        campaignId={campaignId}
        subrow={
          <nav className="max-w-6xl mx-auto px-4 flex items-center gap-1 overflow-x-auto text-sm border-t border-ember-900/20 pt-2 pb-0">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setSelectedType(tab.key)}
                className={`flex items-center gap-1.5 px-2.5 py-2 border-b-2 whitespace-nowrap flex-shrink-0 transition-colors ${
                  selectedType === tab.key ? 'border-ember-400 text-ember-200' : 'border-transparent text-ember-300/40 hover:text-ember-300/70'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        }
      />

      <main className="max-w-6xl mx-auto px-4 pt-28 pb-28">
        <p className="text-ember-300/50 text-sm mb-6">A living knowledge base updated by the AI GM</p>

        {/* Search */}
        <div className="relative mb-6">
          <input
            type="text"
            placeholder="Search wiki entries..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 w-full pl-10"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ember-400/50" />
        </div>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Entry List */}
        <div className="lg:col-span-1">
          <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
            <h3 className="text-sm font-bold text-ember-300/60 mb-3">
              {tabs.find(t => t.key === selectedType)?.label} ({filteredEntries.length})
            </h3>

            {loading ? (
              <div className="flex justify-center py-8">
                <div className="relative">
                  <div className="spinner h-12 w-12"></div>
                  <div className="absolute inset-0 h-12 w-12 rounded-full bg-primary-500/20 animate-ping"></div>
                </div>
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-ember-400/50 text-sm">
                  {searchQuery ? 'No entries match your search' : 'No entries yet'}
                </p>
                <p className="text-xs text-ember-500/40 mt-2">
                  Entries are automatically created as the story unfolds
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredEntries.map((entry: any) => (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedEntry(entry)}
                    className={`w-full text-left p-3 rounded-xl transition-all duration-200 ${
                      selectedEntry?.id === entry.id
                        ? 'bg-gradient-to-r from-ember-900/30 to-ember-900/10 border border-ember-700/50 shadow-lg shadow-black/20'
                        : 'bg-black/25 border border-ember-900/30 hover:border-ember-700/40 hover:bg-black/35'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-1.5">
                      <h4 className="font-semibold text-ember-100 text-sm">{entry.name}</h4>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getImportanceColor(entry.importance)}`}>
                        {entry.importance}
                      </span>
                    </div>
                    <p className="text-xs text-ember-300/60 line-clamp-2 leading-relaxed">{entry.summary}</p>
                    {entry.lastSeenTurn && (
                      <p className="text-xs text-ember-400/50 mt-2 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Last seen: Turn {entry.lastSeenTurn}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Entry Detail */}
        <div className="lg:col-span-2">
          {selectedEntry ? (
            <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-ember-100 mb-1">{selectedEntry.name}</h2>
                  {selectedEntry.aliases && selectedEntry.aliases.length > 0 && (
                    <p className="text-sm text-ember-400/50">
                      Also known as: {selectedEntry.aliases.join(', ')}
                    </p>
                  )}
                </div>
                <span className={`px-3 py-1 rounded ${getImportanceColor(selectedEntry.importance)}`}>
                  {selectedEntry.importance}
                </span>
              </div>

              {selectedEntry.imageUrl && (
                <img
                  src={selectedEntry.imageUrl}
                  alt={selectedEntry.name}
                  className="w-full h-48 object-cover rounded-lg mb-4"
                />
              )}

              <div className="mb-4">
                <h3 className="text-sm font-bold text-ember-300/60 mb-2">Summary</h3>
                <p className="text-ember-200/80">{selectedEntry.summary}</p>
              </div>

              <div className="mb-4">
                <h3 className="text-sm font-bold text-ember-300/60 mb-2">Details</h3>
                <p className="text-ember-200/80 whitespace-pre-wrap">{selectedEntry.description}</p>
              </div>

              {selectedEntry.tags && selectedEntry.tags.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-bold text-ember-300/60 mb-2">Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedEntry.tags.map((tag: string, i: number) => (
                      <span key={i} className="px-3 py-1 bg-black/30 border border-ember-900/30 text-ember-200/80 rounded-lg text-xs font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selectedEntry.changelog && selectedEntry.changelog.length > 0 && (
                <div className="mt-6 pt-6 border-t border-ember-900/30">
                  <h3 className="text-sm font-bold text-ember-300/60 mb-4 flex items-center gap-2">
                    <svg className="w-4 h-4 text-ember-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    History
                  </h3>
                  <div className="space-y-3">
                    {selectedEntry.changelog.map((change: any, i: number) => (
                      <div key={i} className="text-sm p-3 bg-black/25 rounded-lg border border-ember-900/30">
                        <span className="text-ember-300 font-medium">Turn {change.turn}:</span>{' '}
                        <span className="text-ember-200/80">{change.summary}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-6 pt-4 border-t border-ember-900/30 flex items-center justify-between text-xs text-ember-400/50">
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
            <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 text-center px-5 py-12">
              <div className="text-6xl mb-4">📖</div>
              <p className="text-ember-300/60">Select an entry to view details</p>
            </div>
          )}
        </div>
      </div>
      </main>

      <TavernNav campaignId={campaignId} />
    </TavernPage>
  )
}
