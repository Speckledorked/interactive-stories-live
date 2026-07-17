// src/app/campaigns/[id]/admin/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { authenticatedFetch, setLastCampaignId } from '@/lib/clientAuth'
import WorldStateDashboard from '@/components/admin/WorldStateDashboard'
import ClockProgress from '@/components/clock/ClockProgress'
import AILoadingState from '@/components/scene/AILoadingState'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import LoreManagerPanel from '@/components/admin/LoreManagerPanel'

interface Campaign {
  id: string
  title: string
  description: string | null
  universe: string | null
  aiSystemPrompt: string
  initialWorldSeed: string
  contentModerationLevel: string
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
  factionId: string | null
  factionRole: string | null
  isDiscovered: boolean
}

interface Faction {
  id: string
  name: string
  description: string
  goals: string
  goal: string
  archetype: string
  resources: number
  influence: number
  currentPlan: string
  threatLevel: number
  gmNotes: string
  isActive: boolean
  leaderCharacterId: string | null
  isDiscovered: boolean
  relationships?: Record<string, { type: 'RIVAL' | 'ALLY'; since: number }> | null
}

// Keep in sync with FactionGoal in prisma/schema.prisma.
const FACTION_GOALS = ['EXPAND', 'DEFEND', 'ENRICH', 'DESTABILIZE_RIVAL', 'CONSOLIDATE'] as const

// Keep in sync with FactionArchetype in prisma/schema.prisma. Only used to
// pick which flavor list the world-sim ambition system draws from (see
// AMBITION_CATEGORY_OPTIONS in src/lib/game/tick/ambitionTick.ts) — it's
// cosmetic everywhere else.
const FACTION_ARCHETYPES: Array<{ value: string; label: string }> = [
  { value: 'GENERIC', label: 'Generic (guild, kingdom, house)' },
  { value: 'SECRET_SOCIETY', label: 'Secret Society' },
  { value: 'CRIMINAL', label: 'Criminal Organization' },
  { value: 'RELIGIOUS', label: 'Religious Order' },
  { value: 'MILITARY', label: 'Military Order' },
  { value: 'CORPORATION', label: 'Corporation' },
  { value: 'POLITICAL', label: 'Political Faction' },
]

interface Location {
  id: string
  name: string
  description: string | null
  locationType: string | null
  gmNotes: string | null
  ownerFactionId: string | null
  isDiscovered: boolean
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
  const initialTab = searchParams?.get('tab') as 'dashboard' | 'ai' | 'npcs' | 'factions' | 'locations' | 'clocks' | 'lore' | 'map' | 'debug' | 'invites' | 'members' | 'safety' | 'settings' || 'dashboard'

  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'ai' | 'npcs' | 'factions' | 'locations' | 'clocks' | 'lore' | 'map' | 'debug' | 'invites' | 'members' | 'safety' | 'settings'>(initialTab)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [npcs, setNpcs] = useState<NPC[]>([])
  const [factions, setFactions] = useState<Faction[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [characters, setCharacters] = useState<{ id: string; name: string }[]>([])
  const [clocks, setClocks] = useState<Clock[]>([])
  const [invites, setInvites] = useState<any[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [simulationSettings, setSimulationSettings] = useState<{
    factionCap: number | null
    npcCap: number | null
    worldTurnHours: number | null
    defaultFactionCap: number
    defaultNpcCap: number
    defaultWorldTurnHours: number
  } | null>(null)
  const [worldEvents, setWorldEvents] = useState<any[]>([])
  const [worldEventsTurn, setWorldEventsTurn] = useState<number | null>(null)
  const [worldEventsLoading, setWorldEventsLoading] = useState(false)
  const [tickPreview, setTickPreview] = useState<any[] | null>(null)
  const [tickPreviewLoading, setTickPreviewLoading] = useState(false)
  const [editingNpc, setEditingNpc] = useState<string | null>(null)
  const [editingFaction, setEditingFaction] = useState<string | null>(null)
  const [editingLocation, setEditingLocation] = useState<string | null>(null)
  const [editingClock, setEditingClock] = useState<string | null>(null)
  const [creatingNpc, setCreatingNpc] = useState(false)
  const [creatingFaction, setCreatingFaction] = useState(false)
  const [creatingLocation, setCreatingLocation] = useState(false)
  const [creatingClock, setCreatingClock] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [reports, setReports] = useState<any[]>([])
  const [reportsLoading, setReportsLoading] = useState(false)
  const [bans, setBans] = useState<any[]>([])
  const [xcardHistory, setXcardHistory] = useState<any[]>([])
  const [safetyLoaded, setSafetyLoaded] = useState(false)
  const [safetySettings, setSafetySettings] = useState<{
    xCardEnabled: boolean
    anonymousXCard: boolean
    pauseOnXCard: boolean
    xCardNotifyGMOnly: boolean
    lines: string[]
    veils: string[]
  } | null>(null)
  const [linesText, setLinesText] = useState('')
  const [veilsText, setVeilsText] = useState('')
  const [savingSafetySettings, setSavingSafetySettings] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (activeTab === 'debug' && worldEvents.length === 0 && !worldEventsLoading) {
      fetchWorldEvents(worldEventsTurn)
    }
    if (activeTab === 'safety' && !safetyLoaded && !reportsLoading) {
      fetchSafetyData()
    }
    if (activeTab === 'settings' && chronicleShare === null && !chronicleShareLoading) {
      fetchChronicleShare()
    }
  }, [activeTab])

  const [chronicleShare, setChronicleShare] = useState<{ enabled: boolean; token: string | null } | null>(null)
  const [chronicleShareLoading, setChronicleShareLoading] = useState(false)

  const fetchChronicleShare = async () => {
    setChronicleShareLoading(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/chronicle-share`)
      if (response.ok) setChronicleShare(await response.json())
    } catch (err) {
      setError('Failed to load chronicle share state')
    } finally {
      setChronicleShareLoading(false)
    }
  }

  const handleEnableChronicleShare = async () => {
    setChronicleShareLoading(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/chronicle-share`, { method: 'POST' })
      if (response.ok) setChronicleShare(await response.json())
    } catch (err) {
      setError('Failed to enable chronicle share')
    } finally {
      setChronicleShareLoading(false)
    }
  }

  const handleDisableChronicleShare = async () => {
    if (!confirm('Disable the public chronicle link? The current link will stop working immediately.')) return
    setChronicleShareLoading(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/chronicle-share`, { method: 'DELETE' })
      if (response.ok) setChronicleShare(await response.json())
    } catch (err) {
      setError('Failed to disable chronicle share')
    } finally {
      setChronicleShareLoading(false)
    }
  }

  const fetchSafetyData = async () => {
    setReportsLoading(true)
    try {
      const [reportsRes, bansRes, xcardRes, settingsRes] = await Promise.all([
        authenticatedFetch(`/api/campaigns/${campaignId}/reports`),
        authenticatedFetch(`/api/campaigns/${campaignId}/bans`),
        authenticatedFetch(`/api/campaigns/${campaignId}/xcard`),
        authenticatedFetch(`/api/campaigns/${campaignId}/safety-settings`),
      ])
      if (reportsRes.ok) setReports((await reportsRes.json()).reports || [])
      if (bansRes.ok) setBans((await bansRes.json()).bans || [])
      if (xcardRes.ok) setXcardHistory(await xcardRes.json() || [])
      if (settingsRes.ok) {
        const settings = await settingsRes.json()
        setSafetySettings(settings)
        setLinesText((settings.lines || []).join('\n'))
        setVeilsText((settings.veils || []).join('\n'))
      }
      setSafetyLoaded(true)
    } catch (err) {
      setError('Failed to load safety data')
    } finally {
      setReportsLoading(false)
    }
  }

  const handleSaveSafetySettings = async () => {
    if (!safetySettings) return
    setSavingSafetySettings(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/safety-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...safetySettings,
          lines: linesText.split('\n').map(l => l.trim()).filter(Boolean),
          veils: veilsText.split('\n').map(v => v.trim()).filter(Boolean),
        }),
      })
      if (!response.ok) throw new Error('Failed to save safety settings')
      const settings = await response.json()
      setSafetySettings(settings)
      setLinesText((settings.lines || []).join('\n'))
      setVeilsText((settings.veils || []).join('\n'))
    } catch (err) {
      setError('Failed to save safety settings')
    } finally {
      setSavingSafetySettings(false)
    }
  }

  const handleResolveReport = async (reportId: string, actionTaken?: string) => {
    const resolution = prompt('Resolution note for this report:')
    if (resolution === null) return
    setSaving(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', resolution, actionTaken }),
      })
      if (!response.ok) throw new Error('Failed to resolve report')
      setSafetyLoaded(false)
      await fetchSafetyData()
    } catch (err) {
      setError('Failed to resolve report')
    } finally {
      setSaving(false)
    }
  }

  const handleDismissReport = async (reportId: string) => {
    setSaving(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss', resolution: 'Dismissed — no action needed' }),
      })
      if (!response.ok) throw new Error('Failed to dismiss report')
      setSafetyLoaded(false)
      await fetchSafetyData()
    } catch (err) {
      setError('Failed to dismiss report')
    } finally {
      setSaving(false)
    }
  }

  const handleBanMember = async (userId: string) => {
    const reason = prompt('Reason for banning this member (they will be removed and unable to rejoin):')
    if (!reason || !reason.trim()) return
    setSaving(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/members/${userId}/ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, isPermanent: true }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to ban member')
      }
      setSafetyLoaded(false)
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to ban member')
    } finally {
      setSaving(false)
    }
  }

  const handleUnbanMember = async (userId: string) => {
    setSaving(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/members/${userId}/ban`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('Failed to unban member')
      setSafetyLoaded(false)
      await fetchSafetyData()
    } catch (err) {
      setError('Failed to unban member')
    } finally {
      setSaving(false)
    }
  }

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
      setLastCampaignId(campaignId)

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

      // Fetch Characters (for the faction leader picker)
      const charactersResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/characters`)
      if (charactersResponse.ok) {
        const charactersData = await charactersResponse.json()
        setCharacters(charactersData.characters || [])
      }

      // Fetch Locations
      const locationsResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/locations`)
      if (locationsResponse.ok) {
        const locationsData = await locationsResponse.json()
        setLocations(locationsData.locations || [])
      }

      // Fetch Clocks
      const clocksResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/clocks`)
      if (clocksResponse.ok) {
        const clocksData = await clocksResponse.json()
        setClocks(clocksData.clocks || [])
      }

      // Fetch simulation settings (tick caps)
      const simSettingsResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/settings/simulation`)
      if (simSettingsResponse.ok) {
        setSimulationSettings(await simSettingsResponse.json())
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
          contentModerationLevel: campaign.contentModerationLevel,
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

  const [generatingExtras, setGeneratingExtras] = useState(false)
  const handleGenerateWorldExtras = async () => {
    setGeneratingExtras(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/world-extras`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Generation failed')
      const parts = []
      if (data.archetypesCreated > 0) parts.push(`${data.archetypesCreated} origin archetypes created`)
      parts.push(
        data.corruptionThemeSet
          ? `corruption theme: "${data.corruptionThemeName}"`
          : data.corruptionThemeName === null
            ? 'no corruption theme — this universe has no power-at-a-cost concept (that\'s a valid outcome)'
            : 'corruption theme already existed'
      )
      alert(`Done: ${parts.join('; ')}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate world extras')
    } finally {
      setGeneratingExtras(false)
    }
  }

  const handleSaveSimulationSettings = async () => {
    if (!simulationSettings) return
    setSaving(true)

    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/settings/simulation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factionCap: simulationSettings.factionCap,
          npcCap: simulationSettings.npcCap,
          worldTurnHours: simulationSettings.worldTurnHours,
        }),
      })

      if (!response.ok) throw new Error('Failed to save')

      setError('')
      alert('Simulation settings saved successfully!')
    } catch (err) {
      setError('Failed to save simulation settings')
    } finally {
      setSaving(false)
    }
  }

  const fetchWorldEvents = async (turn?: number | null) => {
    setWorldEventsLoading(true)
    try {
      const qs = turn !== undefined && turn !== null ? `?turn=${turn}` : ''
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/world-events${qs}`)
      if (response.ok) {
        const data = await response.json()
        setWorldEvents(data.events || [])
      }
    } catch (err) {
      setError('Failed to load world events')
    } finally {
      setWorldEventsLoading(false)
    }
  }

  const handlePreviewTick = async () => {
    setTickPreviewLoading(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/world-tick/preview`, {
        method: 'POST',
      })
      if (response.ok) {
        const data = await response.json()
        setTickPreview(data.changes || [])
      } else {
        setError('Failed to preview world tick')
      }
    } catch (err) {
      setError('Failed to preview world tick')
    } finally {
      setTickPreviewLoading(false)
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

  const handleUpdateLocation = async (location: Location) => {
    setSaving(true)

    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/locations/${location.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(location),
      })

      if (!response.ok) throw new Error('Failed to update')

      setEditingLocation(null)
      await fetchData()
    } catch (err) {
      setError('Failed to update location')
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

  const handleCreateLocation = async (locationData: Partial<Location>) => {
    setSaving(true)

    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(locationData),
      })

      if (!response.ok) throw new Error('Failed to create location')

      setCreatingLocation(false)
      await fetchData()
    } catch (err) {
      setError('Failed to create location')
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
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Admin" campaignId={campaignId} isAdmin />
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
        campaignId={campaignId}
        isAdmin
        subrow={
          <nav className="max-w-7xl mx-auto px-4 flex items-center gap-1 overflow-x-auto text-sm border-t border-ember-900/20 pt-2 pb-0">
            {(['dashboard', 'ai', 'npcs', 'factions', 'locations', 'clocks', 'lore', 'map', 'debug', 'invites', 'members', 'safety', 'settings'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-2.5 py-2 border-b-2 whitespace-nowrap flex-shrink-0 capitalize transition-colors ${
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

                <div>
                  <label className="block text-sm font-medium text-ember-200/80">
                    Content Moderation
                  </label>
                  <p className="text-xs text-ember-400/50 mb-1">
                    Player actions are checked before reaching the AI. Standard allows ordinary
                    combat and violence — expected content in this kind of game — while still
                    blocking genuinely severe content (sexual content involving minors, self-harm
                    instructions, credible threats). Strict blocks anything OpenAI's moderation
                    flags, including plain violence.
                  </p>
                  <select
                    value={campaign.contentModerationLevel}
                    onChange={(e) => setCampaign({ ...campaign, contentModerationLevel: e.target.value })}
                    className="mt-1 block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                  >
                    <option value="standard">Standard (default — allows genre-typical violence)</option>
                    <option value="strict">Strict (blocks all flagged content, including violence)</option>
                  </select>
                </div>

                <button
                  onClick={handleSaveAISettings}
                  disabled={saving}
                  className="px-4 py-2 bg-wine-600 text-white rounded-md hover:bg-wine-500 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save AI Settings'}
                </button>

                <div className="mt-8 pt-6 border-t border-ember-900/30">
                  <h3 className="font-semibold mb-1">Origin Archetypes & Corruption Theme</h3>
                  <p className="text-xs text-ember-400/50 mb-3">
                    New campaigns generate these automatically. If this campaign predates that (or generation
                    failed), backfill them here: 4 ready-to-play archetype cards for character creation, and this
                    universe&apos;s power-at-a-cost corruption theme — if its fiction has one. Only fills what&apos;s
                    missing; never replaces existing cards or an existing theme.
                  </p>
                  <button
                    onClick={handleGenerateWorldExtras}
                    disabled={generatingExtras}
                    className="px-4 py-2 bg-wine-600 text-white rounded-md hover:bg-wine-500 disabled:opacity-50"
                  >
                    {generatingExtras ? 'Generating...' : 'Generate Archetypes & Corruption Theme'}
                  </button>
                </div>

                {simulationSettings && (
                  <div className="mt-8 pt-6 border-t border-ember-900/30">
                    <h3 className="font-semibold mb-1">Simulation Caps</h3>
                    <p className="text-xs text-ember-400/50 mb-3">
                      How many factions/NPCs the world tick simulates each turn. Leave blank to use the default —
                      only campaigns whose roster has grown past it need to raise this.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">
                          Faction cap (default {simulationSettings.defaultFactionCap})
                        </label>
                        <input
                          type="number"
                          min={1}
                          placeholder={String(simulationSettings.defaultFactionCap)}
                          value={simulationSettings.factionCap ?? ''}
                          onChange={(e) =>
                            setSimulationSettings({
                              ...simulationSettings,
                              factionCap: e.target.value === '' ? null : parseInt(e.target.value),
                            })
                          }
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">
                          NPC cap (default {simulationSettings.defaultNpcCap})
                        </label>
                        <input
                          type="number"
                          min={1}
                          placeholder={String(simulationSettings.defaultNpcCap)}
                          value={simulationSettings.npcCap ?? ''}
                          onChange={(e) =>
                            setSimulationSettings({
                              ...simulationSettings,
                              npcCap: e.target.value === '' ? null : parseInt(e.target.value),
                            })
                          }
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        />
                      </div>
                    </div>
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-ember-200/80 mb-1">
                        World advances every N in-game hours (default {simulationSettings.defaultWorldTurnHours})
                      </label>
                      <p className="text-xs text-ember-400/50 mb-2">
                        Factions and NPCs move with story time, not per action — the off-screen world advances once
                        this many fictional hours have passed in play. Lower = a more restless world.
                      </p>
                      <input
                        type="number"
                        min={1}
                        placeholder={String(simulationSettings.defaultWorldTurnHours)}
                        value={simulationSettings.worldTurnHours ?? ''}
                        onChange={(e) =>
                          setSimulationSettings({
                            ...simulationSettings,
                            worldTurnHours: e.target.value === '' ? null : parseInt(e.target.value),
                          })
                        }
                        className="block w-full max-w-xs border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                      />
                    </div>
                    <button
                      onClick={handleSaveSimulationSettings}
                      disabled={saving}
                      className="mt-3 px-4 py-2 bg-wine-600 text-white rounded-md hover:bg-wine-500 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save Simulation Settings'}
                    </button>
                  </div>
                )}
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
                          factionId: (formData.get('factionId') as string) || undefined,
                          factionRole: (formData.get('factionRole') as string) || undefined,
                          isDiscovered: formData.get('isDiscovered') === 'on',
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
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-ember-200/80 mb-1">Faction</label>
                          <select
                            name="factionId"
                            defaultValue=""
                            className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                          >
                            <option value="">None</option>
                            {factions.map((f) => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-ember-200/80 mb-1">Role</label>
                          <select
                            name="factionRole"
                            defaultValue="MEMBER"
                            className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                          >
                            <option value="MEMBER">Member</option>
                            <option value="LEADER">Leader</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          name="isDiscovered"
                          id="npc-isDiscovered"
                          defaultChecked
                          className="rounded border-ember-900/40 bg-black/30"
                        />
                        <label htmlFor="npc-isDiscovered" className="text-sm text-ember-200/80">
                          Discovered by players — uncheck to build them in as hidden background lore until a scene actually reveals them
                        </label>
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
                        <div className="flex space-x-4">
                          <div>
                            <label className="text-xs">Faction</label>
                            <select
                              value={npc.factionId || ''}
                              onChange={(e) => setNpcs(npcs.map(n => n.id === npc.id ? { ...n, factionId: e.target.value || null } : n))}
                              className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                            >
                              <option value="">None</option>
                              {factions.map((f) => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs">Role</label>
                            <select
                              value={npc.factionRole || 'MEMBER'}
                              onChange={(e) => setNpcs(npcs.map(n => n.id === npc.id ? { ...n, factionRole: e.target.value } : n))}
                              className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                              disabled={!npc.factionId}
                            >
                              <option value="MEMBER">Member</option>
                              <option value="LEADER">Leader</option>
                            </select>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={npc.isDiscovered}
                            onChange={(e) => setNpcs(npcs.map(n => n.id === npc.id ? { ...n, isDiscovered: e.target.checked } : n))}
                            className="rounded border-ember-900/40 bg-black/30"
                          />
                          <label className="text-xs">Discovered by players</label>
                        </div>
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
                            <h3 className="font-semibold">
                              {npc.name}
                              {npc.isDiscovered === false && (
                                <span className="ml-2 text-xs font-normal text-ember-400/70 border border-ember-400/30 rounded px-1.5 py-0.5">
                                  Hidden
                                </span>
                              )}
                            </h3>
                            <p className="text-sm text-ember-300/60">{npc.description}</p>
                            <p className="text-xs text-ember-400/50">Importance: {npc.importance}/5</p>
                            {npc.factionId && (
                              <p className="text-xs text-ember-400/50">
                                {npc.factionRole === 'LEADER' ? 'Leads' : 'Member of'} {factions.find(f => f.id === npc.factionId)?.name || 'an unknown faction'}
                              </p>
                            )}
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
                          goal: formData.get('goal') as string || undefined,
                          archetype: formData.get('archetype') as string || undefined,
                          currentPlan: formData.get('currentPlan') as string || undefined,
                          threatLevel: parseInt(formData.get('threatLevel') as string) || 1,
                          resources: parseInt(formData.get('resources') as string) || 50,
                          gmNotes: formData.get('gmNotes') as string || undefined,
                          leaderCharacterId: (formData.get('leaderCharacterId') as string) || undefined,
                          isDiscovered: formData.get('isDiscovered') === 'on',
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
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-ember-200/80 mb-1">Simulation Goal</label>
                          <select
                            name="goal"
                            defaultValue="CONSOLIDATE"
                            className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                          >
                            {FACTION_GOALS.map((g) => (
                              <option key={g} value={g}>{g.replace('_', ' ')}</option>
                            ))}
                          </select>
                          <p className="text-xs text-ember-400/50 mt-1">Drives what this faction pursues in the background each turn.</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-ember-200/80 mb-1">Archetype</label>
                          <select
                            name="archetype"
                            defaultValue="GENERIC"
                            className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                          >
                            {FACTION_ARCHETYPES.map((a) => (
                              <option key={a.value} value={a.value}>{a.label}</option>
                            ))}
                          </select>
                          <p className="text-xs text-ember-400/50 mt-1">Shapes the flavor of ambitions this faction pursues (e.g. tournament vs. coup).</p>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ember-200/80 mb-1">Leader (Player Character)</label>
                        <select
                          name="leaderCharacterId"
                          defaultValue=""
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                        >
                          <option value="">None (NPC-led)</option>
                          {characters.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        <p className="text-xs text-ember-400/50 mt-1">If set, this faction's Simulation Goal is the player's call — the world tick won't reassess it automatically.</p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          name="isDiscovered"
                          id="faction-isDiscovered"
                          defaultChecked
                          className="rounded border-ember-900/40 bg-black/30"
                        />
                        <label htmlFor="faction-isDiscovered" className="text-sm text-ember-200/80">
                          Discovered by players — uncheck to build them in as hidden background lore until a scene actually reveals them
                        </label>
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
                  <div key={faction.id} className={`border border-ember-900/30 rounded-lg p-4 ${faction.isActive === false ? 'opacity-50' : ''}`}>
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
                        <div className="flex space-x-4">
                          <div>
                            <label className="text-xs">Simulation Goal</label>
                            <select
                              value={faction.goal || 'CONSOLIDATE'}
                              onChange={(e) => setFactions(factions.map(f => f.id === faction.id ? { ...f, goal: e.target.value } : f))}
                              className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                            >
                              {FACTION_GOALS.map((g) => (
                                <option key={g} value={g}>{g.replace('_', ' ')}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs">Archetype</label>
                            <select
                              value={faction.archetype || 'GENERIC'}
                              onChange={(e) => setFactions(factions.map(f => f.id === faction.id ? { ...f, archetype: e.target.value } : f))}
                              className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                            >
                              {FACTION_ARCHETYPES.map((a) => (
                                <option key={a.value} value={a.value}>{a.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs">Leader (Player Character)</label>
                          <select
                            value={faction.leaderCharacterId || ''}
                            onChange={(e) => setFactions(factions.map(f => f.id === faction.id ? { ...f, leaderCharacterId: e.target.value || null } : f))}
                            className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                          >
                            <option value="">None (NPC-led)</option>
                            {characters.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={faction.isDiscovered}
                            onChange={(e) => setFactions(factions.map(f => f.id === faction.id ? { ...f, isDiscovered: e.target.checked } : f))}
                            className="rounded border-ember-900/40 bg-black/30"
                          />
                          <label className="text-xs">Discovered by players</label>
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
                            <h3 className="font-semibold">
                              {faction.name}
                              {faction.isActive === false && (
                                <span className="ml-2 text-xs font-normal text-ember-400/70 border border-ember-400/30 rounded px-1.5 py-0.5">
                                  Defunct
                                </span>
                              )}
                              {faction.leaderCharacterId && (
                                <span className="ml-2 text-xs font-normal text-wine-300 border border-wine-400/30 rounded px-1.5 py-0.5">
                                  Player-led
                                </span>
                              )}
                              {faction.isDiscovered === false && (
                                <span className="ml-2 text-xs font-normal text-ember-400/70 border border-ember-400/30 rounded px-1.5 py-0.5">
                                  Hidden
                                </span>
                              )}
                            </h3>
                            <p className="text-sm text-ember-300/60">{faction.currentPlan}</p>
                            <p className="text-xs text-ember-400/50">
                              Threat: {faction.threatLevel}/5 | Resources: {faction.resources}/100
                            </p>
                            <p className="text-xs text-ember-400/50">
                              {(faction.goal || 'CONSOLIDATE').replace('_', ' ')} · {FACTION_ARCHETYPES.find(a => a.value === faction.archetype)?.label || 'Generic'}
                              {faction.leaderCharacterId && ` · Led by ${characters.find(c => c.id === faction.leaderCharacterId)?.name || 'a player'}`}
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

            {/* Locations Tab */}
            {activeTab === 'locations' && (
              <div className="space-y-4">
                <button
                  onClick={() => setCreatingLocation(true)}
                  className="px-4 py-2 bg-wine-600 text-white rounded-md hover:bg-wine-500"
                >
                  + Create Location
                </button>

                {creatingLocation && (
                  <div className="border border-ember-900/30 rounded-lg p-4 bg-black/25">
                    <h3 className="font-semibold mb-3">Create New Location</h3>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        const formData = new FormData(e.currentTarget)
                        handleCreateLocation({
                          name: formData.get('name') as string,
                          description: formData.get('description') as string || undefined,
                          locationType: formData.get('locationType') as string || undefined,
                          ownerFactionId: (formData.get('ownerFactionId') as string) || undefined,
                          gmNotes: formData.get('gmNotes') as string || undefined,
                          isDiscovered: formData.get('isDiscovered') === 'on',
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
                          <label className="block text-sm font-medium text-ember-200/80 mb-1">Type</label>
                          <input
                            type="text"
                            name="locationType"
                            placeholder="town, dungeon, wilderness, inn..."
                            className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-ember-200/80 mb-1">Owner Faction</label>
                          <select
                            name="ownerFactionId"
                            defaultValue=""
                            className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                          >
                            <option value="">None</option>
                            {factions.map((f) => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          name="isDiscovered"
                          id="location-isDiscovered"
                          defaultChecked
                          className="rounded border-ember-900/40 bg-black/30"
                        />
                        <label htmlFor="location-isDiscovered" className="text-sm text-ember-200/80">
                          Discovered by players — uncheck to place it on the map as hidden background lore until a scene actually reveals it
                        </label>
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
                          onClick={() => setCreatingLocation(false)}
                          className="px-3 py-2 bg-black/40 text-white rounded-md hover:bg-black/50"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {locations.map((location) => (
                  <div key={location.id} className="border border-ember-900/30 rounded-lg p-4">
                    {editingLocation === location.id ? (
                      <div className="space-y-2">
                        <input
                          value={location.name}
                          onChange={(e) => setLocations(locations.map(l => l.id === location.id ? { ...l, name: e.target.value } : l))}
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                        />
                        <textarea
                          value={location.description || ''}
                          onChange={(e) => setLocations(locations.map(l => l.id === location.id ? { ...l, description: e.target.value } : l))}
                          placeholder="Description"
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                          rows={2}
                        />
                        <div className="flex space-x-4">
                          <div className="flex-1">
                            <label className="text-xs">Type</label>
                            <input
                              type="text"
                              value={location.locationType || ''}
                              onChange={(e) => setLocations(locations.map(l => l.id === location.id ? { ...l, locationType: e.target.value } : l))}
                              className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-xs">Owner Faction</label>
                            <select
                              value={location.ownerFactionId || ''}
                              onChange={(e) => setLocations(locations.map(l => l.id === location.id ? { ...l, ownerFactionId: e.target.value || null } : l))}
                              className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                            >
                              <option value="">None</option>
                              {factions.map((f) => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={location.isDiscovered}
                            onChange={(e) => setLocations(locations.map(l => l.id === location.id ? { ...l, isDiscovered: e.target.checked } : l))}
                            className="rounded border-ember-900/40 bg-black/30"
                          />
                          <label className="text-xs">Discovered by players</label>
                        </div>
                        <textarea
                          value={location.gmNotes || ''}
                          onChange={(e) => setLocations(locations.map(l => l.id === location.id ? { ...l, gmNotes: e.target.value } : l))}
                          placeholder="GM Notes"
                          className="block w-full border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm"
                          rows={2}
                        />
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleUpdateLocation(location)}
                            disabled={saving}
                            className="px-3 py-1 bg-success-600 text-white rounded-md hover:bg-success-500 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingLocation(null)}
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
                            <h3 className="font-semibold">
                              {location.name}
                              {location.isDiscovered === false && (
                                <span className="ml-2 text-xs font-normal text-ember-400/70 border border-ember-400/30 rounded px-1.5 py-0.5">
                                  Hidden
                                </span>
                              )}
                            </h3>
                            <p className="text-sm text-ember-300/60">{location.description}</p>
                            <p className="text-xs text-ember-400/50">
                              {location.locationType || 'unknown'}
                              {location.ownerFactionId && ` · Controlled by ${factions.find(f => f.id === location.ownerFactionId)?.name || 'a faction'}`}
                            </p>
                          </div>
                          <button
                            onClick={() => setEditingLocation(location.id)}
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

            {/* Lore Tab */}
            {activeTab === 'lore' && (
              <LoreManagerPanel campaignId={campaignId} />
            )}

            {/* Map Tab — faction relationships (rival/ally) + territory */}
            {activeTab === 'map' && (
              <div className="space-y-6">
                <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
                  <h3 className="font-semibold mb-1">Faction Relationships</h3>
                  <p className="text-xs text-ember-400/50 mb-4">
                    Red dashed = rival, green solid = ally. Only active factions are shown.
                  </p>
                  {(() => {
                    const activeFactions = factions.filter((f) => f.isActive !== false)
                    if (activeFactions.length === 0) {
                      return <p className="text-sm text-ember-400/50 italic">No active factions yet.</p>
                    }
                    const center = 160
                    const radius = 120
                    const positions = activeFactions.map((f, i) => {
                      const angle = (2 * Math.PI * i) / activeFactions.length - Math.PI / 2
                      return { id: f.id, name: f.name, x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) }
                    })
                    const posById = new Map(positions.map((p) => [p.id, p]))
                    const edges: Array<{ from: string; to: string; type: 'RIVAL' | 'ALLY' }> = []
                    const seenPairs = new Set<string>()
                    for (const f of activeFactions) {
                      const rels = f.relationships || {}
                      for (const [otherId, rel] of Object.entries(rels)) {
                        if (!posById.has(otherId)) continue
                        const key = [f.id, otherId].sort().join(':')
                        if (seenPairs.has(key)) continue
                        seenPairs.add(key)
                        edges.push({ from: f.id, to: otherId, type: rel.type })
                      }
                    }
                    return (
                      <svg viewBox="0 0 320 320" className="w-full max-w-md mx-auto">
                        {edges.map((e, i) => {
                          const a = posById.get(e.from)!
                          const b = posById.get(e.to)!
                          return (
                            <line
                              key={i}
                              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                              stroke={e.type === 'RIVAL' ? '#dc2626' : '#22c55e'}
                              strokeWidth={2}
                              strokeDasharray={e.type === 'RIVAL' ? '5 4' : undefined}
                              opacity={0.75}
                            />
                          )
                        })}
                        {positions.map((p) => (
                          <g key={p.id}>
                            <circle cx={p.x} cy={p.y} r={24} fill="#1c1410" stroke="#a8703a" strokeWidth={1.5} />
                            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={9} fill="#f2c98a">
                              {p.name.length > 10 ? p.name.slice(0, 9) + '…' : p.name}
                            </text>
                          </g>
                        ))}
                      </svg>
                    )
                  })()}
                </div>

                <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
                  <h3 className="font-semibold mb-3">Territory</h3>
                  {locations.length === 0 ? (
                    <p className="text-sm text-ember-400/50 italic">No locations tracked yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {factions
                        .filter((f) => locations.some((l) => l.ownerFactionId === f.id))
                        .map((f) => (
                          <div key={f.id}>
                            <h4 className="text-sm font-semibold text-ember-200">{f.name}</h4>
                            <p className="text-xs text-ember-300/60">
                              {locations.filter((l) => l.ownerFactionId === f.id).map((l) => l.name).join(', ')}
                            </p>
                          </div>
                        ))}
                      {locations.some((l) => !l.ownerFactionId) && (
                        <div>
                          <h4 className="text-sm font-semibold text-ember-400/60">Unclaimed</h4>
                          <p className="text-xs text-ember-300/60">
                            {locations.filter((l) => !l.ownerFactionId).map((l) => l.name).join(', ')}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Debug Tab — inspect why a tick made a given decision.
                The Tick Log below browses already-recorded WorldEvent rows
                (past turns). The Preview panel dry-runs the NEXT tick against
                live current state: every handler's writes are skipped (see
                TickContext.dryRun), so nothing is persisted and the turn
                number doesn't advance — this is a preview of what the next
                tick would do, not a replay of a past one (there's no
                snapshot of past DB state to replay against). */}
            {activeTab === 'debug' && (
              <div className="space-y-4">
                <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
                  <h3 className="font-semibold mb-1">Preview Next Tick</h3>
                  <p className="text-xs text-ember-400/50 mb-4">
                    Dry-runs the world tick against current state — shows exactly what would change and why,
                    without writing anything or advancing the turn.
                  </p>
                  <button
                    onClick={handlePreviewTick}
                    disabled={tickPreviewLoading}
                    className="px-4 py-2 bg-wine-600 text-white rounded-md hover:bg-wine-500 disabled:opacity-50"
                  >
                    {tickPreviewLoading ? 'Simulating...' : 'Preview Next Tick'}
                  </button>

                  {tickPreview !== null && (
                    <div className="mt-4 space-y-2">
                      {tickPreview.length === 0 ? (
                        <p className="text-sm text-ember-400/50 italic">No changes — the next tick would be a no-op.</p>
                      ) : (
                        tickPreview.map((change: any, i: number) => (
                          <div key={i} className="p-3 bg-black/25 rounded-lg border border-ember-900/30">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-semibold text-ember-200">
                                {change.entityName} · {change.field}
                              </span>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${change.significant ? 'text-ember-300 bg-ember-900/30' : 'text-ember-400/50 bg-black/30'}`}>
                                {change.importance}
                              </span>
                            </div>
                            <p className="text-xs text-ember-300/70">
                              <span className="text-ember-400/60">{change.previousValue ?? '—'}</span>
                              {' → '}
                              <span className="text-ember-200">{change.newValue ?? '—'}</span>
                            </p>
                            <p className="text-xs text-ember-400/50 mt-1 italic">{change.reason}</p>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
                  <h3 className="font-semibold mb-1">Tick Log</h3>
                  <p className="text-xs text-ember-400/50 mb-4">
                    Every deterministic tick change and player-action consequence, with the reason the simulation
                    made that call. Leave the turn blank for the most recent events across all turns.
                  </p>
                  <div className="flex items-end gap-3 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-ember-200/80 mb-1">Turn</label>
                      <input
                        type="number"
                        min={1}
                        placeholder="latest"
                        value={worldEventsTurn ?? ''}
                        onChange={(e) => setWorldEventsTurn(e.target.value === '' ? null : parseInt(e.target.value))}
                        className="block w-28 border rounded-md border-ember-900/40 bg-black/30 text-ember-100 shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm px-3 py-2"
                      />
                    </div>
                    <button
                      onClick={() => fetchWorldEvents(worldEventsTurn)}
                      disabled={worldEventsLoading}
                      className="px-4 py-2 bg-wine-600 text-white rounded-md hover:bg-wine-500 disabled:opacity-50"
                    >
                      {worldEventsLoading ? 'Loading...' : 'Load'}
                    </button>
                  </div>

                  {worldEventsLoading ? (
                    <p className="text-sm text-ember-400/50">Loading...</p>
                  ) : worldEvents.length === 0 ? (
                    <p className="text-sm text-ember-400/50 italic">No events found.</p>
                  ) : (
                    <div className="space-y-2">
                      {worldEvents.map((event: any) => (
                        <div key={event.id} className="p-3 bg-black/25 rounded-lg border border-ember-900/30">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-semibold text-ember-200">
                              Turn {event.turnNumber} · {event.targetName}
                            </span>
                            <span className="text-xs text-ember-400/50">{event.origin}</span>
                          </div>
                          <p className="text-xs text-ember-300/70">
                            {event.field}: <span className="text-ember-400/60">{event.previousValue ?? '—'}</span>
                            {' → '}
                            <span className="text-ember-200">{event.newValue ?? '—'}</span>
                          </p>
                          <p className="text-xs text-ember-400/50 mt-1 italic">{event.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}
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
                            title="Remove from campaign — they can rejoin with a new invite"
                          >
                            Remove
                          </button>
                          {member.role !== 'ADMIN' && (
                            <button
                              onClick={() => handleBanMember(member.user.id)}
                              disabled={saving}
                              className="px-3 py-1 bg-black/40 border border-wine-700/50 text-wine-300 rounded-md hover:bg-wine-900/30 disabled:opacity-50 text-sm"
                              title="Ban — removes them and blocks rejoining via invite link"
                            >
                              Ban
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Safety Tab */}
            {activeTab === 'safety' && (
              <div className="space-y-8">
                {reportsLoading && <div className="text-sm text-ember-300/60">Loading safety data...</div>}

                {safetySettings && (
                  <div>
                    <h3 className="text-lg font-semibold text-ember-100 mb-1">Safety Settings</h3>
                    <p className="text-xs text-ember-300/50 mb-3">
                      Lines are enforced in every scene the AI narrates — never included, not even implied. Veils may happen off-page but are never described directly.
                    </p>
                    <div className="border border-ember-900/30 rounded-lg p-4 space-y-4">
                      <div className="grid sm:grid-cols-2 gap-3">
                        <label className="flex items-center gap-2 text-sm text-ember-200">
                          <input
                            type="checkbox"
                            checked={safetySettings.xCardEnabled}
                            onChange={(e) => setSafetySettings({ ...safetySettings, xCardEnabled: e.target.checked })}
                          />
                          X-Card enabled
                        </label>
                        <label className="flex items-center gap-2 text-sm text-ember-200">
                          <input
                            type="checkbox"
                            checked={safetySettings.pauseOnXCard}
                            onChange={(e) => setSafetySettings({ ...safetySettings, pauseOnXCard: e.target.checked })}
                          />
                          Pause the scene when the X-Card is used
                        </label>
                        <label className="flex items-center gap-2 text-sm text-ember-200">
                          <input
                            type="checkbox"
                            checked={safetySettings.anonymousXCard}
                            onChange={(e) => setSafetySettings({ ...safetySettings, anonymousXCard: e.target.checked })}
                          />
                          Keep who used the X-Card anonymous
                        </label>
                        <label className="flex items-center gap-2 text-sm text-ember-200">
                          <input
                            type="checkbox"
                            checked={safetySettings.xCardNotifyGMOnly}
                            onChange={(e) => setSafetySettings({ ...safetySettings, xCardNotifyGMOnly: e.target.checked })}
                          />
                          Notify GM only (not the whole table)
                        </label>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-ember-200/80 mb-1">Lines (hard limits, one per line)</label>
                          <textarea
                            value={linesText}
                            onChange={(e) => setLinesText(e.target.value)}
                            placeholder={'e.g. sexual violence\nharm to children'}
                            className="w-full px-3 py-2 bg-black/30 border border-ember-900/40 rounded-lg text-ember-100 placeholder-ember-500/40 focus:outline-none focus:border-ember-500 resize-none text-sm"
                            rows={4}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-ember-200/80 mb-1">Veils (soft limits, one per line)</label>
                          <textarea
                            value={veilsText}
                            onChange={(e) => setVeilsText(e.target.value)}
                            placeholder={'e.g. torture\ngraphic injury detail'}
                            className="w-full px-3 py-2 bg-black/30 border border-ember-900/40 rounded-lg text-ember-100 placeholder-ember-500/40 focus:outline-none focus:border-ember-500 resize-none text-sm"
                            rows={4}
                          />
                        </div>
                      </div>
                      <button
                        onClick={handleSaveSafetySettings}
                        disabled={savingSafetySettings}
                        className="px-4 py-2 bg-wine-600 hover:bg-wine-500 text-white rounded-md disabled:opacity-50 text-sm"
                      >
                        {savingSafetySettings ? 'Saving...' : 'Save Safety Settings'}
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="text-lg font-semibold text-ember-100 mb-3">Content Reports</h3>
                  {reports.filter(r => r.status === 'PENDING' || r.status === 'REVIEWING').length === 0 ? (
                    <p className="text-sm text-ember-300/50">No open reports.</p>
                  ) : (
                    <div className="space-y-2">
                      {reports.filter(r => r.status === 'PENDING' || r.status === 'REVIEWING').map((report) => (
                        <div key={report.id} className="border border-ember-900/30 rounded-lg p-4">
                          <div className="flex justify-between items-start gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded text-xs font-medium bg-ember-900/25 text-ember-300">
                                  {report.contentType}
                                </span>
                                <span className="px-2 py-0.5 rounded text-xs font-medium bg-wine-800/25 text-wine-300">
                                  {report.severity}
                                </span>
                              </div>
                              <p className="text-sm text-ember-200 mt-2">{report.reason}</p>
                              {report.contentText && (
                                <p className="text-xs text-ember-300/50 mt-1 italic">&ldquo;{report.contentText}&rdquo;</p>
                              )}
                              <p className="text-xs text-ember-400/50 mt-1">
                                Reported {new Date(report.createdAt).toLocaleString()}
                              </p>
                            </div>
                            <div className="flex gap-2 flex-shrink-0">
                              <button
                                onClick={() => handleResolveReport(report.id)}
                                disabled={saving}
                                className="px-3 py-1 bg-wine-600 text-white rounded-md hover:bg-wine-500 disabled:opacity-50 text-sm"
                              >
                                Resolve
                              </button>
                              <button
                                onClick={() => handleDismissReport(report.id)}
                                disabled={saving}
                                className="px-3 py-1 bg-black/30 border border-ember-900/40 text-ember-200 rounded-md hover:bg-black/40 disabled:opacity-50 text-sm"
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-ember-100 mb-3">X-Card History</h3>
                  {xcardHistory.length === 0 ? (
                    <p className="text-sm text-ember-300/50">No X-Card uses recorded.</p>
                  ) : (
                    <div className="space-y-2">
                      {xcardHistory.map((use: any) => (
                        <div key={use.id} className="border border-ember-900/30 rounded-lg p-3 text-sm">
                          <span className="text-ember-200 font-medium">{use.trigger}</span>
                          {use.reason && <span className="text-ember-300/60"> — {use.reason}</span>}
                          <span className="text-xs text-ember-400/50 block mt-1">
                            {new Date(use.createdAt).toLocaleString()}
                            {use.acknowledged ? ' • acknowledged' : ' • unacknowledged'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-ember-100 mb-3">Banned Users</h3>
                  {bans.length === 0 ? (
                    <p className="text-sm text-ember-300/50">No one is banned from this campaign.</p>
                  ) : (
                    <div className="space-y-2">
                      {bans.map((ban: any) => (
                        <div key={ban.id} className="border border-ember-900/30 rounded-lg p-4 flex justify-between items-start gap-4">
                          <div>
                            <p className="text-ember-200 font-medium">{ban.user?.name || ban.user?.email || ban.userId}</p>
                            <p className="text-sm text-ember-300/60">{ban.reason}</p>
                            <p className="text-xs text-ember-400/50 mt-1">
                              Banned {new Date(ban.createdAt).toLocaleDateString()}
                              {ban.isPermanent ? ' • permanent' : ban.expiresAt ? ` • until ${new Date(ban.expiresAt).toLocaleDateString()}` : ''}
                            </p>
                          </div>
                          <button
                            onClick={() => handleUnbanMember(ban.userId)}
                            disabled={saving}
                            className="px-3 py-1 bg-black/30 border border-ember-900/40 text-ember-200 rounded-md hover:bg-black/40 disabled:opacity-50 text-sm flex-shrink-0"
                          >
                            Unban
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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

                {/* Public Chronicle Link Section */}
                <div className="border-b pb-6">
                  <h3 className="text-lg font-semibold text-ember-100 mb-2">
                    Public Chronicle Link
                  </h3>
                  <p className="text-sm text-ember-300/60 mb-4">
                    A read-only, no-login-required page showing every resolved scene in order — nothing else (no character sheets, no admin data). Off by default; share it as far as you like once on.
                  </p>
                  {chronicleShare?.enabled ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={typeof window !== 'undefined' ? `${window.location.origin}/chronicle/${chronicleShare.token}` : ''}
                          className="flex-1 px-3 py-2 border rounded-md border-ember-900/40 bg-black/30 text-ember-100 text-sm font-mono"
                          onFocus={(e) => e.target.select()}
                        />
                        <button
                          onClick={() => {
                            if (typeof window !== 'undefined') {
                              navigator.clipboard.writeText(`${window.location.origin}/chronicle/${chronicleShare.token}`)
                            }
                          }}
                          className="px-3 py-2 bg-black/30 border border-ember-900/40 text-ember-200 rounded-md hover:bg-black/40 text-sm flex-shrink-0"
                        >
                          Copy
                        </button>
                      </div>
                      <button
                        onClick={handleDisableChronicleShare}
                        disabled={chronicleShareLoading}
                        className="px-4 py-2 bg-black/30 border border-wine-700/50 text-wine-300 rounded-md hover:bg-wine-900/20 disabled:opacity-50 text-sm"
                      >
                        Disable Public Link
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleEnableChronicleShare}
                      disabled={chronicleShareLoading}
                      className="px-4 py-2 bg-wine-600 text-white rounded-md hover:bg-wine-500 disabled:opacity-50 text-sm"
                    >
                      {chronicleShareLoading ? 'Enabling...' : 'Enable Public Link'}
                    </button>
                  )}
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
