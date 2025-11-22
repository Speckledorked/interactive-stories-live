// src/app/campaigns/[id]/page.tsx
// Campaign lobby - shows campaign info, players, characters
// UPDATED WITH PHASE 8 COMMUNICATION FEATURES

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { authenticatedFetch, isAuthenticated, getUser } from '@/lib/clientAuth'
import EnhancedCreateCharacterForm from "@/components/forms/EnhancedCreateCharacterForm"
import ChatPanel from '@/components/chat/ChatPanel'
import NotesPanel from '@/components/notes/NotesPanel'
import NotificationPanel from '@/components/notifications/NotificationPanel'
import TurnTracker from '@/components/turns/TurnTracker'
import { PlayerMapViewer } from '@/components/maps/PlayerMapViewer'

interface CampaignData {
  campaign: any
  userRole: 'ADMIN' | 'PLAYER'
}

export default function CampaignLobbyPage() {
  const router = useRouter()
  const params = useParams()
  const campaignId = params.id as string

  const [data, setData] = useState<CampaignData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateCharacter, setShowCreateCharacter] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'chat' | 'notes' | 'maps' | 'progression'>('overview')
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaign')
    } finally {
      setLoading(false)
    }
  }

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
      <div className="flex justify-center items-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="card max-w-2xl mx-auto">
        <p className="text-red-400">{error || 'Campaign not found'}</p>
        <Link href="/campaigns" className="text-primary-400 hover:underline mt-4 inline-block">
          ← Back to campaigns
        </Link>
      </div>
    )
  }

  const { campaign, userRole } = data
  const currentUser = getUser()
  const userCharacters = campaign.characters.filter(
    (c: any) => c.userId === currentUser?.id
  )

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/campaigns"
          className="text-primary-400 hover:text-primary-300 text-sm mb-4 inline-block"
        >
          ← Back to campaigns
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">{campaign.title}</h1>
            <p className="text-gray-400">{campaign.description}</p>
            <div className="flex items-center space-x-4 mt-4 text-sm text-gray-500">
              <span>Universe: {campaign.universe}</span>
              <span>•</span>
              <span>Turn {campaign.worldMeta?.currentTurnNumber || 0}</span>
              <span>•</span>
              <span>{campaign.worldMeta?.currentInGameDate || 'Day 1'}</span>
            </div>
          </div>
          {userRole === 'ADMIN' && (
            <Link
              href={`/campaigns/${campaignId}/admin`}
              className="btn-secondary"
            >
              ⚙️ Settings
            </Link>
          )}
        </div>
      </div>

      {/* Navigation Tabs - Phase 8 Communication */}
      <div className="border-b border-gray-700 mb-6 sticky top-0 bg-gray-950/95 backdrop-blur z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            {[
              { key: 'overview', label: 'Overview' },
              { key: 'progression', label: 'Story Log' },
              { key: 'chat', label: 'Chat' },
              { key: 'notes', label: 'Notes' },
              { key: 'maps', label: 'Maps' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.key
                    ? 'border-primary-500 text-primary-400'
                    : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Overview Tab - Existing Content */}
      {activeTab === 'overview' && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Enter Story Button */}
          <div className="card">
            <h2 className="card-header">Ready to Play?</h2>
            <p className="text-gray-400 mb-4">
              {userCharacters.length === 0
                ? 'Create a character first to enter the story'
                : 'Jump into the adventure!'}
            </p>
            <Link
              href={`/campaigns/${campaignId}/story`}
              className={`btn-primary inline-block ${
                userCharacters.length === 0 ? 'opacity-50 pointer-events-none' : ''
              }`}
            >
              🎭 Enter Story
            </Link>
          </div>

          {/* Your Characters */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="card-header mb-0">Your Characters</h2>
              <button
                type="button"
                onClick={() => setShowCreateCharacter(true)}
                className="text-primary-400 hover:text-primary-300 text-sm"
              >
                + Create Character
              </button>
            </div>

            {userCharacters.length === 0 ? (
              <p className="text-gray-500 text-sm">No characters yet. Create one to play!</p>
            ) : (
              <div className="space-y-3">
                {userCharacters.map((character: any) => (
                  <div key={character.id} className="bg-gray-900 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-bold text-white">{character.name}</h3>
                        <p className="text-sm text-gray-400">{character.concept}</p>
                        {character.currentLocation && (
                          <p className="text-xs text-gray-500 mt-1">
                            📍 {character.currentLocation}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded text-xs ${
                          character.isAlive
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-gray-700 text-gray-400'
                        }`}>
                          {character.isAlive ? 'Alive' : 'Dead'}
                        </span>
                        <button
                          onClick={() => setDeletingCharacterId(character.id)}
                          className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-500/10"
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
                            className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs"
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
          <div className="card">
            <h2 className="card-header">All Characters</h2>
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
                        ? 'bg-primary-900/20 border border-primary-700 hover:bg-primary-900/30'
                        : 'hover:bg-gray-800'
                    }`}
                  >
                    <div>
                      <span className={`font-medium ${isMyCharacter ? 'text-primary-300' : 'text-white'} group-hover:text-primary-400`}>
                        {character.name}
                        {isMyCharacter && (
                          <span className="ml-2 text-xs bg-primary-600 text-white px-2 py-0.5 rounded">You</span>
                        )}
                      </span>
                      <span className="text-gray-500 text-sm ml-2">
                        ({character.user.email})
                      </span>
                    </div>
                    <span className="text-gray-600 group-hover:text-primary-500">→</span>
                  </Link>
                )
              })}
              {campaign.characters.length === 0 && (
                <p className="text-gray-500 text-sm">No characters in this campaign yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Players */}
          <div className="card">
            <h2 className="card-header">Players</h2>
            <div className="space-y-2">
              {campaign.memberships.map((member: any) => (
                <div key={member.id} className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">{member.user.email}</span>
                  <span className={`px-2 py-1 rounded text-xs ${
                    member.role === 'ADMIN'
                      ? 'bg-primary-500/20 text-primary-400'
                      : 'bg-gray-700 text-gray-300'
                  }`}>
                    {member.role}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="card">
            <h2 className="card-header">Campaign Stats</h2>
            <p className="text-xs text-gray-500 mb-3">Click to view in wiki</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Scenes:</span>
                <span className="text-white font-medium">{campaign.scenes.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Characters:</span>
                <span className="text-white font-medium">{campaign.characters.length}</span>
              </div>
              <Link
                href={`/campaigns/${campaignId}/wiki?type=NPC`}
                className="flex justify-between hover:bg-gray-800 p-2 -m-2 rounded transition-colors group"
              >
                <span className="text-gray-400 group-hover:text-primary-400 transition-colors">
                  NPCs:
                </span>
                <span className="text-white font-medium group-hover:text-primary-400 transition-colors">
                  {campaign.npcs.length} →
                </span>
              </Link>
              <Link
                href={`/campaigns/${campaignId}/wiki?type=FACTION`}
                className="flex justify-between hover:bg-gray-800 p-2 -m-2 rounded transition-colors group"
              >
                <span className="text-gray-400 group-hover:text-primary-400 transition-colors">
                  Factions:
                </span>
                <span className="text-white font-medium group-hover:text-primary-400 transition-colors">
                  {campaign.factions.length} →
                </span>
              </Link>
              <Link
                href={`/campaigns/${campaignId}/wiki?type=CLOCK`}
                className="flex justify-between hover:bg-gray-800 p-2 -m-2 rounded transition-colors group"
              >
                <span className="text-gray-400 group-hover:text-primary-400 transition-colors">
                  Active Clocks:
                </span>
                <span className="text-white font-medium group-hover:text-primary-400 transition-colors">
                  {campaign.clocks.length} →
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
          <div className="card">
            <h2 className="card-header mb-4">Campaign Story Log</h2>
            <p className="text-gray-400 mb-6">
              A chronicle of your adventure, updated after each scene
            </p>

            {logsLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
              </div>
            ) : campaignLogs.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📜</div>
                <p className="text-gray-400 mb-2">No story entries yet</p>
                <p className="text-sm text-gray-500">
                  The story log will be automatically updated as scenes are resolved
                </p>
              </div>
            ) : (
              <>
                {/* Timeline Bar */}
                <div className="mb-8 bg-gray-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-400">Campaign Progress</span>
                    <span className="text-sm text-gray-500">
                      Turn {campaignLogs[campaignLogs.length - 1]?.turnNumber || 0}
                    </span>
                  </div>
                  <div className="relative h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="absolute top-0 left-0 h-full bg-gradient-to-r from-primary-600 to-primary-400 transition-all"
                      style={{ width: `${Math.min((campaignLogs.length / 20) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-2 text-xs text-gray-500">
                    <span>{campaignLogs.length} scenes completed</span>
                    <span>Milestone at 20 scenes</span>
                  </div>
                </div>

                {/* Log Entries */}
                <div className="space-y-4">
                  {campaignLogs.map((log: any, index: number) => (
                    <div
                      key={log.id}
                      className="bg-gray-900 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition-colors"
                    >
                      {/* Header */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-primary-400">
                              Turn {log.turnNumber}
                            </span>
                            {log.entryType !== 'scene' && (
                              <span className="text-xs px-2 py-0.5 bg-gray-700 text-gray-300 rounded">
                                {log.entryType}
                              </span>
                            )}
                          </div>
                          <h3 className="text-lg font-bold text-white">{log.title}</h3>
                          {log.inGameDate && (
                            <p className="text-xs text-gray-500 mt-1">
                              📅 {log.inGameDate}
                              {log.duration && ` • Duration: ${log.duration}`}
                            </p>
                          )}
                        </div>
                        <span className="text-xs text-gray-500">
                          {new Date(log.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                      {/* Summary */}
                      <p className="text-gray-300 mb-3 whitespace-pre-wrap">{log.summary}</p>

                      {/* Highlights */}
                      {log.highlights && log.highlights.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-700">
                          <h4 className="text-xs font-medium text-gray-400 mb-2">
                            Key Moments:
                          </h4>
                          <ul className="space-y-1">
                            {log.highlights.map((highlight: string, i: number) => (
                              <li key={i} className="text-sm text-gray-400 flex items-start gap-2">
                                <span className="text-primary-500 mt-1">•</span>
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
            currentUserId={data.campaign.memberships[0]?.userId || ''}
            currentUserName={data.campaign.memberships[0]?.user?.email || 'Unknown'}
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
            currentUserId={data.campaign.memberships[0]?.userId || ''}
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
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="card-header mb-0">Campaign Maps</h2>
              {userRole === 'ADMIN' && (
                <button
                  onClick={() => setShowCreateMap(true)}
                  className="text-primary-400 hover:text-primary-300 text-sm"
                >
                  + Create Map
                </button>
              )}
            </div>

            {/* Create Map Form */}
            {showCreateMap && userRole === 'ADMIN' && (
              <div className="bg-gray-900 rounded-lg p-4 mb-4 border border-gray-700">
                <h3 className="text-white font-bold mb-3">Create New Map</h3>
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
                      <label className="block text-sm text-gray-400 mb-1">Map Name</label>
                      <input
                        type="text"
                        value={newMapName}
                        onChange={(e) => setNewMapName(e.target.value)}
                        className="input-field w-full"
                        placeholder="e.g., Tavern Floor Plan, Dungeon Level 1"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Description</label>
                      <textarea
                        value={newMapDescription}
                        onChange={(e) => setNewMapDescription(e.target.value)}
                        className="input-field w-full"
                        rows={2}
                        placeholder="Optional description"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={creatingMap || !newMapName.trim()}
                        className="btn-primary"
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
                        className="btn-secondary"
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
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
              </div>
            ) : maps.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🗺️</div>
                <p className="text-gray-400 mb-2">No maps yet</p>
                <p className="text-sm text-gray-500">
                  {userRole === 'ADMIN'
                    ? 'Create a map to visualize locations and track character positions'
                    : 'The GM will create maps as the adventure unfolds'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {maps.map((map: any) => (
                  <div key={map.id} className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-bold text-white">{map.name}</h3>
                          {map.isActive && (
                            <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded">
                              Active
                            </span>
                          )}
                        </div>
                        {map.description && (
                          <p className="text-sm text-gray-400">{map.description}</p>
                        )}
                        <div className="flex items-center gap-4 text-xs text-gray-500 mt-2">
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
                            className="text-xs px-3 py-1 bg-primary-600 hover:bg-primary-700 text-white rounded"
                          >
                            Set Active
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Map Preview */}
                    <div className="rounded-lg overflow-hidden border border-gray-700 bg-gray-800">
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

      {/* Notification Panel - Phase 8/9 Communication */}
      {data && (
        <NotificationPanel
          userId={data.campaign.memberships[0]?.userId || ''}
          campaignId={campaignId}
          isOpen={showNotifications}
          onClose={() => setShowNotifications(false)}
        />
      )}

      {/* Character Creation Modal */}
      {showCreateCharacter && (
        <div className="fixed inset-0 bg-gray-900/80 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-950 border border-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-2xl font-bold mb-4 text-white">Create New Character</h2>
            <EnhancedCreateCharacterForm
              campaignId={campaignId}
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
        <div className="fixed inset-0 bg-gray-900/80 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-950 border border-gray-800 rounded-lg max-w-md w-full p-6">
            <h2 className="text-2xl font-bold mb-4 text-white">Delete Character?</h2>
            <p className="text-gray-400 mb-6">
              Are you sure you want to delete this character? This action cannot be undone.
              All associated actions and data will be permanently removed.
            </p>
            {deleteError && (
              <div className="bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-lg mb-4">
                {deleteError}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setDeletingCharacterId(null)
                  setDeleteError('')
                }}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteCharacter(deletingCharacterId)}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors flex-1"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
