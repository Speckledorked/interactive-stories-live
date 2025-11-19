// src/app/campaigns/[id]/admin/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Campaign {
  id: string
  title: string
  aiSystemPrompt: string
  initialWorldSeed: string
}

interface NPC {
  id: string
  name: string
  description: string
  currentLocation: string
  goals: string
  relationship: string
  isAlive: boolean
  importance: number
  gmNotes: string
}

interface Faction {
  id: string
  name: string
  description: string
  goals: string
  resources: number
  influence: number
  currentPlan: string
  threatLevel: number
  gmNotes: string
}

interface Clock {
  id: string
  name: string
  description: string
  segments: number
  filled: number
  category: string
  isHidden: boolean
  triggersAt: number | null
  gmNotes: string
}

export default function AdminPage({ 
  params 
}: { 
  params: { id: string } 
}) {
  const router = useRouter()
  const campaignId = params.id

  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'ai' | 'npcs' | 'factions' | 'clocks' | 'invites'>('ai')
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [npcs, setNpcs] = useState<NPC[]>([])
  const [factions, setFactions] = useState<Faction[]>([])
  const [clocks, setClocks] = useState<Clock[]>([])
  const [invites, setInvites] = useState<any[]>([])
  const [editingNpc, setEditingNpc] = useState<string | null>(null)
  const [editingFaction, setEditingFaction] = useState<string | null>(null)
  const [editingClock, setEditingClock] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      // Fetch campaign data
      const campResponse = await fetch(`/api/campaigns/${campaignId}`)
      if (!campResponse.ok) {
        router.push(`/campaigns/${campaignId}`)
        return
      }
      const campData = await campResponse.json()
      setCampaign(campData.campaign)

      // Fetch NPCs
      const npcsResponse = await fetch(`/api/campaigns/${campaignId}/npcs`)
      if (npcsResponse.ok) {
        const npcsData = await npcsResponse.json()
        setNpcs(npcsData.npcs || [])
      }

      // Fetch Factions
      const factionsResponse = await fetch(`/api/campaigns/${campaignId}/factions`)
      if (factionsResponse.ok) {
        const factionsData = await factionsResponse.json()
        setFactions(factionsData.factions || [])
      }

      // Fetch Clocks
      const clocksResponse = await fetch(`/api/campaigns/${campaignId}/clocks`)
      if (clocksResponse.ok) {
        const clocksData = await clocksResponse.json()
        setClocks(clocksData.clocks || [])
      }

      // Fetch Invites
      const invitesResponse = await fetch(`/api/campaigns/${campaignId}/invites`)
      if (invitesResponse.ok) {
        const invitesData = await invitesResponse.json()
        setInvites(invitesData.invites || [])
      }
    } catch (err) {
      setError('Failed to load admin data')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveAISettings = async () => {
    if (!campaign) return
    setSaving(true)
    
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/settings/ai`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiSystemPrompt: campaign.aiSystemPrompt,
          initialWorldSeed: campaign.initialWorldSeed,
        }),
      })

      if (!response.ok) throw new Error('Failed to save')
      
      setError('')
      alert('AI settings saved successfully!')
    } catch (err) {
      setError('Failed to save AI settings')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateNPC = async (npc: NPC) => {
    setSaving(true)
    
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/npcs/${npc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(npc),
      })

      if (!response.ok) throw new Error('Failed to update')
      
      setEditingNpc(null)
      await fetchData()
    } catch (err) {
      setError('Failed to update NPC')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateFaction = async (faction: Faction) => {
    setSaving(true)
    
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/factions/${faction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(faction),
      })

      if (!response.ok) throw new Error('Failed to update')
      
      setEditingFaction(null)
      await fetchData()
    } catch (err) {
      setError('Failed to update faction')
    } finally {
      setSaving(false)
    }
  }

  const handleTickClock = async (clockId: string, action: 'tick' | 'untick') => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/clocks/${clockId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })

      if (!response.ok) throw new Error('Failed to update clock')
      
      await fetchData()
    } catch (err) {
      setError('Failed to update clock')
    }
  }

  const handleToggleClockVisibility = async (clock: Clock) => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/clocks/${clock.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...clock, isHidden: !clock.isHidden }),
      })

      if (!response.ok) throw new Error('Failed to update clock')
      
      await fetchData()
    } catch (err) {
      setError('Failed to update clock')
    }
  }

  const handleCreateInvite = async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (!response.ok) throw new Error('Failed to create invite')
      
      const data = await response.json()
      alert(`Invite created! Share this link: ${data.joinUrl}`)
      await fetchData()
    } catch (err) {
      setError('Failed to create invite')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-6">
              Campaign Admin Settings
            </h1>

            {error && (
              <div className="mb-4 bg-red-50 text-red-900 p-4 rounded-md">
                {error}
              </div>
            )}

            {/* Tab Navigation */}
            <div className="border-b border-gray-200 mb-6">
              <nav className="-mb-px flex space-x-8">
                {(['ai', 'npcs', 'factions', 'clocks', 'invites'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`
                      py-2 px-1 border-b-2 font-medium text-sm capitalize
                      ${activeTab === tab
                        ? 'border-indigo-500 text-indigo-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
                    `}
                  >
                    {tab === 'ai' ? 'AI Settings' : tab}
                  </button>
                ))}
              </nav>
            </div>

            {/* AI Settings Tab */}
            {activeTab === 'ai' && campaign && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    AI System Prompt
                  </label>
                  <textarea
                    value={campaign.aiSystemPrompt}
                    onChange={(e) => setCampaign({ ...campaign, aiSystemPrompt: e.target.value })}
                    rows={10}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Initial World Seed
                  </label>
                  <textarea
                    value={campaign.initialWorldSeed}
                    onChange={(e) => setCampaign({ ...campaign, initialWorldSeed: e.target.value })}
                    rows={6}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                </div>

                <button
                  onClick={handleSaveAISettings}
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save AI Settings'}
                </button>
              </div>
            )}

            {/* NPCs Tab */}
            {activeTab === 'npcs' && (
              <div className="space-y-4">
                {npcs.map((npc) => (
                  <div key={npc.id} className="border rounded-lg p-4">
                    {editingNpc === npc.id ? (
                      <div className="space-y-2">
                        <input
                          value={npc.name}
                          onChange={(e) => setNpcs(npcs.map(n => n.id === npc.id ? { ...n, name: e.target.value } : n))}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        />
                        <textarea
                          value={npc.description || ''}
                          onChange={(e) => setNpcs(npcs.map(n => n.id === npc.id ? { ...n, description: e.target.value } : n))}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          rows={2}
                        />
                        <input
                          type="number"
                          min="1"
                          max="5"
                          value={npc.importance}
                          onChange={(e) => setNpcs(npcs.map(n => n.id === npc.id ? { ...n, importance: parseInt(e.target.value) } : n))}
                          className="block w-32 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        />
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleUpdateNPC(npc)}
                            disabled={saving}
                            className="px-3 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingNpc(null)}
                            className="px-3 py-1 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-semibold">{npc.name}</h3>
                            <p className="text-sm text-gray-600">{npc.description}</p>
                            <p className="text-xs text-gray-500">Importance: {npc.importance}/5</p>
                          </div>
                          <button
                            onClick={() => setEditingNpc(npc.id)}
                            className="px-3 py-1 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Factions Tab */}
            {activeTab === 'factions' && (
              <div className="space-y-4">
                {factions.map((faction) => (
                  <div key={faction.id} className="border rounded-lg p-4">
                    {editingFaction === faction.id ? (
                      <div className="space-y-2">
                        <input
                          value={faction.name}
                          onChange={(e) => setFactions(factions.map(f => f.id === faction.id ? { ...f, name: e.target.value } : f))}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        />
                        <textarea
                          value={faction.currentPlan || ''}
                          onChange={(e) => setFactions(factions.map(f => f.id === faction.id ? { ...f, currentPlan: e.target.value } : f))}
                          placeholder="Current Plan"
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          rows={2}
                        />
                        <div className="flex space-x-4">
                          <div>
                            <label className="text-xs">Threat Level</label>
                            <input
                              type="number"
                              min="1"
                              max="5"
                              value={faction.threatLevel}
                              onChange={(e) => setFactions(factions.map(f => f.id === faction.id ? { ...f, threatLevel: parseInt(e.target.value) } : f))}
                              className="block w-20 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs">Resources</label>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={faction.resources}
                              onChange={(e) => setFactions(factions.map(f => f.id === faction.id ? { ...f, resources: parseInt(e.target.value) } : f))}
                              className="block w-20 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            />
                          </div>
                        </div>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleUpdateFaction(faction)}
                            disabled={saving}
                            className="px-3 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingFaction(null)}
                            className="px-3 py-1 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-semibold">{faction.name}</h3>
                            <p className="text-sm text-gray-600">{faction.currentPlan}</p>
                            <p className="text-xs text-gray-500">
                              Threat: {faction.threatLevel}/5 | Resources: {faction.resources}/100
                            </p>
                          </div>
                          <button
                            onClick={() => setEditingFaction(faction.id)}
                            className="px-3 py-1 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Clocks Tab */}
            {activeTab === 'clocks' && (
              <div className="space-y-4">
                {clocks.map((clock) => (
                  <div key={clock.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold">
                          {clock.name} {clock.isHidden && '(Hidden)'}
                        </h3>
                        <p className="text-sm text-gray-600">{clock.description}</p>
                        <div className="mt-2">
                          <div className="flex space-x-1">
                            {Array.from({ length: clock.segments }).map((_, i) => (
                              <div
                                key={i}
                                className={`w-8 h-8 border-2 rounded-full ${
                                  i < clock.filled
                                    ? 'bg-indigo-600 border-indigo-600'
                                    : 'bg-white border-gray-300'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleTickClock(clock.id, 'tick')}
                          disabled={clock.filled >= clock.segments}
                          className="px-2 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                        >
                          +
                        </button>
                        <button
                          onClick={() => handleTickClock(clock.id, 'untick')}
                          disabled={clock.filled <= 0}
                          className="px-2 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                        >
                          -
                        </button>
                        <button
                          onClick={() => handleToggleClockVisibility(clock)}
                          className={`px-3 py-1 rounded-md ${
                            clock.isHidden
                              ? 'bg-gray-600 text-white hover:bg-gray-700'
                              : 'bg-indigo-600 text-white hover:bg-indigo-700'
                          }`}
                        >
                          {clock.isHidden ? 'Show' : 'Hide'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Invites Tab */}
            {activeTab === 'invites' && (
              <div className="space-y-4">
                <button
                  onClick={handleCreateInvite}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                >
                  Create New Invite
                </button>
                
                <div className="space-y-2">
                  {invites.map((invite) => (
                    <div key={invite.id} className="border rounded-lg p-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm font-mono">{invite.joinUrl}</p>
                          <p className="text-xs text-gray-500">
                            Uses: {invite.uses}/{invite.maxUses === 0 ? '∞' : invite.maxUses}
                            {invite.isExpired && ' (Expired)'}
                            {invite.isExhausted && ' (Exhausted)'}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(invite.joinUrl)
                            alert('Invite link copied!')
                          }}
                          className="px-3 py-1 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
