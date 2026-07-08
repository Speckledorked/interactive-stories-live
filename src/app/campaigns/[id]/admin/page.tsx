// src/app/campaigns/[id]/admin/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { authenticatedFetch } from '@/lib/clientAuth'
import WorldStateDashboard from '@/components/admin/WorldStateDashboard'
import ClockProgress from '@/components/clock/ClockProgress'
import AILoadingState from '@/components/scene/AILoadingState'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'

interface Campaign {
  id: string
  title: string
  description: string | null
  universe: string | null
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
  description: string | null
  currentTicks: number
  maxTicks: number
  category: string | null
  isHidden: boolean
  consequence: string | null
  gmNotes: string | null
}

interface Member {
  id: string
  role: 'ADMIN' | 'PLAYER'
  joinedAt: string
  user: {
    id: string
    name: string | null
    email: string
    createdAt: string
  }
  _count: {
    characters: number
  }
}

export default function AdminPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const campaignId = params.id as string

  // Read tab from URL parameter, default to 'dashboard'
  const initialTab = searchParams?.get('tab') as 'dashboard' | 'ai' | 'npcs' | 'factions' | 'clocks' | 'invites' | 'members' | 'settings' || 'dashboard'

  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'ai' | 'npcs' | 'factions' | 'clocks' | 'invites' | 'members' | 'settings'>(initialTab)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [npcs, setNpcs] = useState<NPC[]>([])
  const [factions, setFactions] = useState<Faction[]>([])
  const [clocks, setClocks] = useState<Clock[]>([])
  const [invites, setInvites] = useState<any[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [editingNpc, setEditingNpc] = useState<string | null>(null)
  const [editingFaction, setEditingFaction] = useState<string | null>(null)
  const [editingClock, setEditingClock] = useState<string | null>(null)
  const [creatingNpc, setCreatingNpc] = useState(false)
  const [creatingFaction, setCreatingFaction] = useState(false)
  const [creatingClock, setCreatingClock] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      // Fetch campaign data
      const campResponse = await authenticatedFetch(`/api/campaigns/${campaignId}`)
      if (!campResponse.ok) {
        router.push(`/campaigns/${campaignId}`)
        return
      }
      const campData = await campResponse.json()

      // Check if user is an admin
      if (campData.userRole !== 'ADMIN') {
        router.push(`/campaigns/${campaignId}`)
        return
      }

      setCampaign(campData.campaign)

      // Fetch NPCs
      const npcsResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/npcs`)
      if (npcsResponse.ok) {
        const npcsData = await npcsResponse.json()
        setNpcs(npcsData.npcs || [])
      }

      // Fetch Factions
      const factionsResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/factions`)
      if (factionsResponse.ok) {
        const factionsData = await factionsResponse.json()
        setFactions(factionsData.factions || [])
      }

      // Fetch Clocks
      const clocksResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/clocks`)
      if (clocksResponse.ok) {
        const clocksData = await clocksResponse.json()
        setClocks(clocksData.clocks || [])
      }

      // Fetch Invites
      const invitesResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/invites`)
      if (invitesResponse.ok) {
        const invitesData = await invitesResponse.json()
        setInvites(invitesData.invites || [])
      }

      // Fetch Members
      const membersResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/members`)
      if (membersResponse.ok) {
        const membersData = await membersResponse.json()
        setMembers(membersData.members || [])
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
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/settings/ai`, {
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
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/npcs/${npc.id}`, {
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
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/factions/${faction.id}`, {
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
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/clocks/${clockId}`, {
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
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/clocks/${clock.id}`, {
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
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/invites`, {
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

  const handleRemoveMember = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this member? Their characters will also be deleted.')) {
      return
    }

    setSaving(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/members/${userId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to remove member')
      }

      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member')
    } finally {
      setSaving(false)
    }
  }

  const handleChangeRole = async (userId: string, newRole: 'ADMIN' | 'PLAYER') => {
    setSaving(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/members/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to change role')
      }

      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change role')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveCampaignInfo = async () => {
    if (!campaign) return
    setSaving(true)

    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: campaign.title,
          description: campaign.description,
          universe: campaign.universe,
        }),
      })

      if (!response.ok) throw new Error('Failed to save')

      setError('')
      alert('Campaign information saved successfully!')
    } catch (err) {
      setError('Failed to save campaign information')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateNPC = async (npcData: Partial<NPC>) => {
    setSaving(true)

    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/npcs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(npcData),
      })

      if (!response.ok) throw new Error('Failed to create NPC')

      setCreatingNpc(false)
      await fetchData()
    } catch (err) {
      setError('Failed to create NPC')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateFaction = async (factionData: Partial<Faction>) => {
    setSaving(true)

    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/factions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(factionData),
      })

      if (!response.ok) throw new Error('Failed to create faction')

      setCreatingFaction(false)
      await fetchData()
    } catch (err) {
      setError('Failed to create faction')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateClock = async (clockData: Partial<Clock>) => {
    setSaving(true)

    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/clocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clockData),
      })

      if (!response.ok) throw new Error('Failed to create clock')

      setCreatingClock(false)
      await fetchData()
    } catch (err) {
      setError('Failed to create clock')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteCampaign = async () => {
    setSaving(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete campaign')

      router.push('/campaigns')
    } catch (err) {
      setError('Failed to delete campaign')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <TavernPage>
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Admin" />
        <main className="max-w-7xl mx-auto px-4 pt-28 pb-16 flex items-center justify-center">
          <AILoadingState />
        </main>
      </TavernPage>
    )
  }

  return (
    <TavernPage>
      <TavernHeader
        backHref={`/campaigns/${campaignId}`}
        title="Campaign Admin"
        subrow={
          <nav className="max-w-7xl mx-auto px-4 flex items-center gap-1 overflow-x-auto text-sm border-t border-ember-900/20 pt-2 pb-0">
            {(['dashboard', 'ai', 'npcs', 'factions', 'clocks', 'invites', 'members', 'settings'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-2.5 pb-2 border-b-2 whitespace-nowrap flex-shrink-0 capitalize transition-colors ${
                  activeTab === tab ? 'border-ember-400 text-ember-200' : 'border-transparent text-ember-300/40 hover:text-ember-300/70'
                }`}
              >
                {tab === 'ai' ? 'AI Settings' : tab}
              </button>
            ))}
          </nav>
        }
      />

      <main className="max-w-7xl mx-auto px-4 pt-28 pb-28">
        {error && (
          <div className="mb-4 bg-wine-800/20 text-wine-300 p-4 rounded-md">
            {error}
          </div>
        )}

            {/* Dashboard Tab */}
            {activeTab === 'dashboard' && (
              <WorldStateDashboard
                npcs={npcs.map(npc => ({
                  id: npc.id,
                  name: npc.name,
                  role: npc.description || '',
                  status: npc.isAlive ? 'alive' : 'dead',
                  relationship: npc.relationship as 'friendly' | 'neutral' | 'hostile' | undefined,
                  lastSeen: npc.currentLocation
                }))}
                factions={factions.map(faction => ({
                  id: faction.id,
                  name: faction.name,
                  influence: faction.influence,
                  relationship: faction.threatLevel >= 4 ? 'hostile' : faction.threatLevel >= 3 ? 'neutral' : 'allied',
                  description: faction.description
                }))}
                clocks={clocks.map(clock => ({
                  id: clock.id,
                  name: clock.name,
                  current: clock.currentTicks,
                  max: clock.maxTicks
                }))}
                worldNotes={campaign?.initialWorldSeed ? [campaign.initialWorldSeed] : []}
              />
            )}

            {/* AI Settings Tab */}
            {activeTab === 'ai' && campaign && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-ember-200/80">
                    AI System Prompt
                  </label>
                  <textarea
                    value={campaign.aiSystemPrompt}
                    onChange={(e) => setCampaign({ ...campaign, aiSystemPrompt: e.target.value })}
                    rows={10}
                    className="mt-1 block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-ember-200/80">
                    Initial World Seed
                  </label>
                  <textarea
                    value={campaign.initialWorldSeed}
                    onChange={(e) => setCampaign({ ...campaign, initialWorldSeed: e.target.value })}
                    rows={6}
                    className="mt-1 block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                  />
                </div>

                <button
                  onClick={handleSaveAISettings}
                  disabled={saving}
                  className="px-4 py-2 bg-wine-600 text-white rounded-md hover:bg-wine-500 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save AI Settings'}
                </button>
              </div>
            )}

            {/* NPCs Tab */}
            {activeTab === 'npcs' && (
              <div className="space-y-4">
                <button
                  onClick={() => setCreatingNpc(true)}
                  className="px-4 py-2 bg-wine-600 text-white rounded-md hover:bg-wine-500"
                >
                  + Create NPC
                </button>

                {creatingNpc && (
                  <div className="border border-ember-900/30 rounded-lg p-4 bg-black/25">
                    <h3 className="font-semibold mb-3">Create New NPC</h3>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        const formData = new FormData(e.currentTarget)
                        handleCreateNPC({
                          name: formData.get('name') as string,
                          description: formData.get('description') as string || undefined,
                          currentLocation: formData.get('currentLocation') as string || undefined,
                          goals: formData.get('goals') as string || undefined,
                          relationship: formData.get('relationship') as string || undefined,
                          importance: parseInt(formData.get('importance') as string) || 1,
                          gmNotes: formData.get('gmNotes') as string || undefined,
                        })
                      }}
                      className="space-y-3"
                    >
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">Name *</label>
                        <input
                          type="text"
                          name="name"
                          required
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">Description</label>
                        <textarea
                          name="description"
                          rows={2}
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-ember-200/80 mb-1">Location</label>
                          <input
                            type="text"
                            name="currentLocation"
                            className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-ember-200/80 mb-1">Importance (1-5)</label>
                          <input
                            type="number"
                            name="importance"
                            min="1"
                            max="5"
                            defaultValue="1"
                            className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">Goals</label>
                        <textarea
                          name="goals"
                          rows={2}
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">Relationship to Party</label>
                        <input
                          type="text"
                          name="relationship"
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">GM Notes</label>
                        <textarea
                          name="gmNotes"
                          rows={2}
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        />
                      </div>
                      <div className="flex space-x-2">
                        <button
                          type="submit"
                          disabled={saving}
                          className="px-3 py-2 bg-success-600 text-white rounded-md hover:bg-success-500 disabled:opacity-50"
                        >
                          {saving ? 'Creating...' : 'Create'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setCreatingNpc(false)}
                          className="px-3 py-2 bg-black/40 text-white rounded-md hover:bg-black/50"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {npcs.map((npc) => (
                  <div key={npc.id} className="border border-ember-900/30 rounded-lg p-4">
                    {editingNpc === npc.id ? (
                      <div className="space-y-2">
                        <input
                          value={npc.name}
                          onChange={(e) => setNpcs(npcs.map(n => n.id === npc.id ? { ...n, name: e.target.value } : n))}
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                        />
                        <textarea
                          value={npc.description || ''}
                          onChange={(e) => setNpcs(npcs.map(n => n.id === npc.id ? { ...n, description: e.target.value } : n))}
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                          rows={2}
                        />
                        <input
                          type="number"
                          min="1"
                          max="5"
                          value={npc.importance}
                          onChange={(e) => setNpcs(npcs.map(n => n.id === npc.id ? { ...n, importance: parseInt(e.target.value) } : n))}
                          className="block w-32 border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                        />
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleUpdateNPC(npc)}
                            disabled={saving}
                            className="px-3 py-1 bg-success-600 text-white rounded-md hover:bg-success-500 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingNpc(null)}
                            className="px-3 py-1 bg-black/40 text-white rounded-md hover:bg-black/50"
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
                            <p className="text-sm text-ember-300/60">{npc.description}</p>
                            <p className="text-xs text-ember-400/50">Importance: {npc.importance}/5</p>
                          </div>
                          <button
                            onClick={() => setEditingNpc(npc.id)}
                            className="px-3 py-1 bg-wine-600 text-white rounded-md hover:bg-wine-500"
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
                <button
                  onClick={() => setCreatingFaction(true)}
                  className="px-4 py-2 bg-wine-600 text-white rounded-md hover:bg-wine-500"
                >
                  + Create Faction
                </button>

                {creatingFaction && (
                  <div className="border border-ember-900/30 rounded-lg p-4 bg-black/25">
                    <h3 className="font-semibold mb-3">Create New Faction</h3>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        const formData = new FormData(e.currentTarget)
                        handleCreateFaction({
                          name: formData.get('name') as string,
                          description: formData.get('description') as string || undefined,
                          goals: formData.get('goals') as string || undefined,
                          currentPlan: formData.get('currentPlan') as string || undefined,
                          threatLevel: parseInt(formData.get('threatLevel') as string) || 1,
                          resources: parseInt(formData.get('resources') as string) || 50,
                          gmNotes: formData.get('gmNotes') as string || undefined,
                        })
                      }}
                      className="space-y-3"
                    >
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">Name *</label>
                        <input
                          type="text"
                          name="name"
                          required
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">Description</label>
                        <textarea
                          name="description"
                          rows={2}
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">Goals</label>
                        <textarea
                          name="goals"
                          rows={2}
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">Current Plan</label>
                        <textarea
                          name="currentPlan"
                          rows={2}
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-ember-200/80 mb-1">Threat Level (1-5)</label>
                          <input
                            type="number"
                            name="threatLevel"
                            min="1"
                            max="5"
                            defaultValue="1"
                            className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-ember-200/80 mb-1">Resources (0-100)</label>
                          <input
                            type="number"
                            name="resources"
                            min="0"
                            max="100"
                            defaultValue="50"
                            className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">GM Notes</label>
                        <textarea
                          name="gmNotes"
                          rows={2}
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        />
                      </div>
                      <div className="flex space-x-2">
                        <button
                          type="submit"
                          disabled={saving}
                          className="px-3 py-2 bg-success-600 text-white rounded-md hover:bg-success-500 disabled:opacity-50"
                        >
                          {saving ? 'Creating...' : 'Create'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setCreatingFaction(false)}
                          className="px-3 py-2 bg-black/40 text-white rounded-md hover:bg-black/50"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {factions.map((faction) => (
                  <div key={faction.id} className="border border-ember-900/30 rounded-lg p-4">
                    {editingFaction === faction.id ? (
                      <div className="space-y-2">
                        <input
                          value={faction.name}
                          onChange={(e) => setFactions(factions.map(f => f.id === faction.id ? { ...f, name: e.target.value } : f))}
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                        />
                        <textarea
                          value={faction.currentPlan || ''}
                          onChange={(e) => setFactions(factions.map(f => f.id === faction.id ? { ...f, currentPlan: e.target.value } : f))}
                          placeholder="Current Plan"
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
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
                              className="block w-20 border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
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
                              className="block w-20 border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                            />
                          </div>
                        </div>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleUpdateFaction(faction)}
                            disabled={saving}
                            className="px-3 py-1 bg-success-600 text-white rounded-md hover:bg-success-500 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingFaction(null)}
                            className="px-3 py-1 bg-black/40 text-white rounded-md hover:bg-black/50"
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
                            <p className="text-sm text-ember-300/60">{faction.currentPlan}</p>
                            <p className="text-xs text-ember-400/50">
                              Threat: {faction.threatLevel}/5 | Resources: {faction.resources}/100
                            </p>
                          </div>
                          <button
                            onClick={() => setEditingFaction(faction.id)}
                            className="px-3 py-1 bg-wine-600 text-white rounded-md hover:bg-wine-500"
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
                <button
                  onClick={() => setCreatingClock(true)}
                  className="px-4 py-2 bg-wine-600 text-white rounded-md hover:bg-wine-500"
                >
                  + Create Clock
                </button>

                {creatingClock && (
                  <div className="border border-ember-900/30 rounded-lg p-4 bg-black/25">
                    <h3 className="font-semibold mb-3">Create New Clock</h3>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        const formData = new FormData(e.currentTarget)
                        handleCreateClock({
                          name: formData.get('name') as string,
                          description: formData.get('description') as string || undefined,
                          maxTicks: parseInt(formData.get('maxTicks') as string) || 4,
                          currentTicks: 0,
                          category: formData.get('category') as string || undefined,
                          isHidden: formData.get('isHidden') === 'on',
                          consequence: formData.get('consequence') as string || undefined,
                          gmNotes: formData.get('gmNotes') as string || undefined,
                        })
                      }}
                      className="space-y-3"
                    >
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">Name *</label>
                        <input
                          type="text"
                          name="name"
                          required
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">Description</label>
                        <textarea
                          name="description"
                          rows={2}
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-ember-200/80 mb-1">Max Segments</label>
                          <input
                            type="number"
                            name="maxTicks"
                            min="1"
                            max="12"
                            defaultValue="4"
                            className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-ember-200/80 mb-1">Category</label>
                          <input
                            type="text"
                            name="category"
                            placeholder="e.g., Threat, Progress"
                            className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">Consequence (when filled)</label>
                        <textarea
                          name="consequence"
                          rows={2}
                          placeholder="What happens when this clock fills..."
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">GM Notes</label>
                        <textarea
                          name="gmNotes"
                          rows={2}
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        />
                      </div>
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          name="isHidden"
                          id="isHidden"
                          className="h-4 w-4 text-ember-300 focus:ring-ember-500/40 border-ember-900/40 rounded"
                        />
                        <label htmlFor="isHidden" className="ml-2 block text-sm text-ember-200/80">
                          Hide from players
                        </label>
                      </div>
                      <div className="flex space-x-2">
                        <button
                          type="submit"
                          disabled={saving}
                          className="px-3 py-2 bg-success-600 text-white rounded-md hover:bg-success-500 disabled:opacity-50"
                        >
                          {saving ? 'Creating...' : 'Create'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setCreatingClock(false)}
                          className="px-3 py-2 bg-black/40 text-white rounded-md hover:bg-black/50"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {clocks.map((clock) => (
                    <div key={clock.id}>
                      <ClockProgress
                        name={clock.name}
                        current={clock.currentTicks}
                        max={clock.maxTicks}
                        description={clock.description || undefined}
                        consequence={clock.consequence || undefined}
                        size="md"
                        isHidden={clock.isHidden}
                        onTick={
                          clock.currentTicks < clock.maxTicks
                            ? () => handleTickClock(clock.id, 'tick')
                            : undefined
                        }
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => handleTickClock(clock.id, 'untick')}
                          disabled={clock.currentTicks <= 0}
                          className="px-3 py-1 bg-wine-600 text-white rounded-md hover:bg-wine-500 disabled:opacity-50 text-sm flex-1"
                        >
                          - Remove Tick
                        </button>
                        <button
                          onClick={() => handleToggleClockVisibility(clock)}
                          className={`px-3 py-1 rounded-md text-sm flex-1 ${
                            clock.isHidden
                              ? 'bg-black/40 text-white hover:bg-black/50'
                              : 'bg-wine-600 text-white hover:bg-wine-500'
                          }`}
                        >
                          {clock.isHidden ? '👁️ Show' : '🔒 Hide'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Invites Tab */}
            {activeTab === 'invites' && (
              <div className="space-y-4">
                <button
                  onClick={handleCreateInvite}
                  className="px-4 py-2 bg-wine-600 text-white rounded-md hover:bg-wine-500"
                >
                  Create New Invite
                </button>

                <div className="space-y-2">
                  {invites.map((invite) => (
                    <div key={invite.id} className="border border-ember-900/30 rounded-lg p-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm font-mono">{invite.joinUrl}</p>
                          <p className="text-xs text-ember-400/50">
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
                          className="px-3 py-1 bg-black/40 text-white rounded-md hover:bg-black/50"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Members Tab */}
            {activeTab === 'members' && (
              <div className="space-y-4">
                <div className="text-sm text-ember-300/60 mb-4">
                  Total Members: {members.length}
                </div>

                <div className="space-y-2">
                  {members.map((member) => (
                    <div key={member.id} className="border border-ember-900/30 rounded-lg p-4">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">
                              {member.user.name || member.user.email}
                            </h3>
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              member.role === 'ADMIN'
                                ? 'bg-wine-800/25 text-ember-300'
                                : 'bg-ember-900/25 text-ember-300'
                            }`}>
                              {member.role}
                            </span>
                          </div>
                          <p className="text-sm text-ember-300/60">{member.user.email}</p>
                          <p className="text-xs text-ember-400/50 mt-1">
                            Joined: {new Date(member.joinedAt).toLocaleDateString()} •
                            Characters: {member._count.characters}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <select
                            value={member.role}
                            onChange={(e) => handleChangeRole(member.user.id, e.target.value as 'ADMIN' | 'PLAYER')}
                            disabled={saving}
                            className="px-3 py-1 border rounded-md text-sm focus:border-ember-400 focus:ring-ember-500/40 disabled:opacity-50"
                          >
                            <option value="PLAYER">Player</option>
                            <option value="ADMIN">Admin</option>
                          </select>
                          <button
                            onClick={() => handleRemoveMember(member.user.id)}
                            disabled={saving}
                            className="px-3 py-1 bg-wine-600 text-white rounded-md hover:bg-wine-500 disabled:opacity-50 text-sm"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Settings Tab */}
            {activeTab === 'settings' && campaign && (
              <div className="space-y-6">
                <div className="border-b pb-6">
                  <h3 className="text-lg font-semibold text-ember-100 mb-4">
                    Campaign Information
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-ember-200/80">
                        Campaign ID (Read-only)
                      </label>
                      <p className="mt-1 text-sm text-ember-300/60 font-mono">{campaignId}</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-ember-200/80">
                        Title
                      </label>
                      <input
                        type="text"
                        value={campaign.title}
                        onChange={(e) => setCampaign({ ...campaign, title: e.target.value })}
                        className="mt-1 block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-ember-200/80">
                        Description
                      </label>
                      <textarea
                        value={campaign.description || ''}
                        onChange={(e) => setCampaign({ ...campaign, description: e.target.value })}
                        rows={3}
                        className="mt-1 block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-ember-200/80">
                        Universe
                      </label>
                      <input
                        type="text"
                        value={campaign.universe || ''}
                        onChange={(e) => setCampaign({ ...campaign, universe: e.target.value })}
                        className="mt-1 block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                      />
                    </div>

                    <button
                      onClick={handleSaveCampaignInfo}
                      disabled={saving}
                      className="px-4 py-2 bg-wine-600 text-white rounded-md hover:bg-wine-500 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save Campaign Information'}
                    </button>
                  </div>
                </div>

                {/* Export & Backup Section */}
                <div className="border-b pb-6">
                  <h3 className="text-lg font-semibold text-ember-100 mb-4">
                    Export & Backup
                  </h3>
                  <p className="text-sm text-ember-300/60 mb-4">
                    Download your campaign data for backup or to move to another platform.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={async () => {
                        try {
                          const response = await authenticatedFetch(`/api/campaigns/${campaignId}/export`)
                          if (response.ok) {
                            const blob = await response.blob()
                            const url = window.URL.createObjectURL(blob)
                            const link = document.createElement('a')
                            link.href = url
                            link.download = `campaign-${campaignId}-${Date.now()}.json`
                            document.body.appendChild(link)
                            link.click()
                            document.body.removeChild(link)
                            window.URL.revokeObjectURL(url)
                          } else {
                            alert('Export failed. Please try again.')
                          }
                        } catch (error) {
                          console.error('Export error:', error)
                          alert('Export failed. Please try again.')
                        }
                      }}
                      className="px-4 py-2 bg-black/40 text-white rounded-md hover:bg-black/50 flex items-center gap-2"
                    >
                      <span>📥</span>
                      Export Campaign (JSON)
                    </button>
                  </div>
                </div>

                {/* Safety Tools Section */}
                <div className="border-b pb-6">
                  <h3 className="text-lg font-semibold text-ember-100 mb-4">
                    Safety Tools
                  </h3>
                  <p className="text-sm text-ember-300/60 mb-4">
                    Configure content warnings and safety settings for your campaign.
                  </p>
                  <div className="space-y-4">
                    <div className="bg-ember-900/15 border border-ember-800/30 rounded-lg p-4">
                      <h4 className="font-medium text-ember-200 mb-2">✋ X-Card</h4>
                      <p className="text-sm text-ember-300/80">
                        The X-Card is always available on the story page. Players can use it
                        anonymously to pause or rewind uncomfortable content.
                      </p>
                    </div>
                    <div className="bg-ember-900/20 border border-ember-700/40 rounded-lg p-4">
                      <h4 className="font-medium text-ember-200 mb-2">⚠️ Content Warnings</h4>
                      <p className="text-sm text-ember-300 mb-3">
                        Set content warnings to let players know what topics may appear in this campaign.
                      </p>
                      <p className="text-xs text-ember-400">
                        Note: Full safety settings panel will be added in a future update.
                        For now, use the X-Card feature during gameplay.
                      </p>
                    </div>
                    <div className="bg-wine-800/15 border border-wine-700/30 rounded-lg p-4">
                      <h4 className="font-medium text-ember-200 mb-2">🛡️ Lines & Veils</h4>
                      <p className="text-sm text-ember-300/80">
                        <strong>Lines:</strong> Hard boundaries that won't appear in the story<br />
                        <strong>Veils:</strong> Content that happens off-screen
                      </p>
                      <p className="text-xs text-ember-400 mt-2">
                        Configure these in Session Zero with your group. Use the X-Card during play.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border border-wine-600/40 rounded-lg p-6 bg-wine-800/20">
                  <h3 className="text-lg font-semibold text-wine-300 mb-2">
                    Danger Zone
                  </h3>
                  <p className="text-sm text-wine-400 mb-4">
                    Once you delete a campaign, there is no going back. This will permanently delete
                    all campaign data including characters, scenes, NPCs, factions, clocks, and timeline events.
                  </p>

                  {!showDeleteConfirm ? (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="px-4 py-2 bg-wine-600 text-white rounded-md hover:bg-wine-500"
                    >
                      Delete Campaign
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-wine-300">
                        Are you absolutely sure? This action cannot be undone.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleDeleteCampaign}
                          disabled={saving}
                          className="px-4 py-2 bg-wine-500 text-white rounded-md hover:bg-wine-600 disabled:opacity-50"
                        >
                          {saving ? 'Deleting...' : 'Yes, Delete Campaign'}
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          disabled={saving}
                          className="px-4 py-2 bg-black/40 text-white rounded-md hover:bg-black/50 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
      </main>

      <TavernNav campaignId={campaignId} />
    </TavernPage>
  )
}
