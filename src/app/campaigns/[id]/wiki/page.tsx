// src/app/campaigns/[id]/wiki/page.tsx
// Campaign wiki - knowledge base for NPCs, factions, locations, etc.

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'

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
      case 'critical': return 'text-red-400 bg-red-500/20'
      case 'major': return 'text-orange-400 bg-orange-500/20'
      case 'normal': return 'text-blue-400 bg-blue-500/20'
      default: return 'text-gray-400 bg-gray-700'
    }
  }

  return (
    <div className="max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <Link
          href={`/campaigns/${campaignId}`}
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition-colors group"
        >
          <svg className="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Campaign
        </Link>

        <div className="relative">
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-primary-500/10 via-accent-500/5 to-transparent blur-3xl"></div>
          <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent mb-3">
            Campaign Wiki
          </h1>
          <p className="text-lg text-gray-400">
            A living knowledge base updated by the AI GM
          </p>
        </div>
      </div>

      <div className="mb-6">

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search wiki entries..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field w-full pl-10"
          />
          <svg
            className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-dark-700/50 mb-8">
        <nav className="flex space-x-2 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setSelectedType(tab.key)}
              className={`relative py-3 px-5 font-semibold text-sm transition-all duration-200 whitespace-nowrap flex items-center gap-2 rounded-t-xl ${
                selectedType === tab.key
                  ? 'text-primary-400 bg-gradient-to-b from-primary-500/10 to-transparent'
                  : 'text-gray-400 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              <span className="text-base">{tab.icon}</span>
              <span>{tab.label}</span>
              {selectedType === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary-600 via-primary-500 to-primary-400 shadow-glow"></div>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Entry List */}
        <div className="lg:col-span-1">
          <div className="card">
            <h3 className="text-sm font-bold text-gray-400 mb-3">
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
                <p className="text-gray-500 text-sm">
                  {searchQuery ? 'No entries match your search' : 'No entries yet'}
                </p>
                <p className="text-xs text-gray-600 mt-2">
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
                        ? 'bg-gradient-to-r from-primary-500/20 to-primary-500/10 border border-primary-500/50 shadow-lg shadow-primary-500/10'
                        : 'bg-dark-800/50 border border-dark-700/50 hover:border-dark-600 hover:bg-dark-800'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-1.5">
                      <h4 className="font-semibold text-white text-sm">{entry.name}</h4>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getImportanceColor(entry.importance)}`}>
                        {entry.importance}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">{entry.summary}</p>
                    {entry.lastSeenTurn && (
                      <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
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
            <div className="card">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-1">{selectedEntry.name}</h2>
                  {selectedEntry.aliases && selectedEntry.aliases.length > 0 && (
                    <p className="text-sm text-gray-500">
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
                <h3 className="text-sm font-bold text-gray-400 mb-2">Summary</h3>
                <p className="text-gray-300">{selectedEntry.summary}</p>
              </div>

              <div className="mb-4">
                <h3 className="text-sm font-bold text-gray-400 mb-2">Details</h3>
                <p className="text-gray-300 whitespace-pre-wrap">{selectedEntry.description}</p>
              </div>

              {selectedEntry.tags && selectedEntry.tags.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-bold text-gray-400 mb-2">Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedEntry.tags.map((tag: string, i: number) => (
                      <span key={i} className="px-3 py-1 bg-dark-800 border border-dark-700 text-gray-300 rounded-lg text-xs font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selectedEntry.changelog && selectedEntry.changelog.length > 0 && (
                <div className="mt-6 pt-6 border-t border-dark-700/50">
                  <h3 className="text-sm font-bold text-gray-400 mb-4 flex items-center gap-2">
                    <svg className="w-4 h-4 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    History
                  </h3>
                  <div className="space-y-3">
                    {selectedEntry.changelog.map((change: any, i: number) => (
                      <div key={i} className="text-sm p-3 bg-dark-800/50 rounded-lg border border-dark-700/50">
                        <span className="text-primary-400 font-medium">Turn {change.turn}:</span>{' '}
                        <span className="text-gray-300">{change.summary}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-6 pt-4 border-t border-dark-700/50 flex items-center justify-between text-xs text-gray-500">
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
            <div className="card text-center py-12">
              <div className="text-6xl mb-4">📖</div>
              <p className="text-gray-400">Select an entry to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
