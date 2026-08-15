// src/components/forms/EnhancedCreateCharacterForm.tsx
// Tabbed character creation form with comprehensive fields

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { authenticatedFetch } from '@/lib/clientAuth'
import { PBTA_STATS } from '@/lib/pbta-moves'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs } from '@/components/ui/tabs'
import { ArrowLeft, ArrowRight, Backpack, BookOpen, Coins, Swords, User, Zap } from 'lucide-react'

// The final tab's submit button sits at the exact same screen position as
// every other tab's "Next →" button. Tapping through tabs quickly, a tap
// aimed at "Next" on the second-to-last tab lands on "Create Character"
// the instant the last tab renders — submitting before the Debts &
// Enemies tab is even visible to read or use. This grace period keeps the
// submit button disabled just long enough for a reflexive tap to miss.
const SUBMIT_GRACE_PERIOD_MS = 500

interface StatLabel {
  label: string
  description: string
}

interface EnhancedCreateCharacterFormProps {
  campaignId: string
  // Fiction-flavored names for the 5 fixed stats, generated for this
  // campaign at creation time (see lib/ai/worldGenerator.ts). Falls back
  // to the generic PBTA_STATS names when a campaign doesn't have them
  // (older campaigns, or generation failed).
  statLabels?: Partial<Record<keyof typeof PBTA_STATS, StatLabel>>
  onSuccess?: () => void
  onCancel?: () => void
}

type TabKey = 'basics' | 'character' | 'stats' | 'equipment' | 'resources' | 'consequences'

export default function EnhancedCreateCharacterForm({
  campaignId,
  statLabels,
  onSuccess,
  onCancel
}: EnhancedCreateCharacterFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<TabKey>('basics')
  const [submitReady, setSubmitReady] = useState(false)

  useEffect(() => {
    if (activeTab !== 'consequences') {
      setSubmitReady(false)
      return
    }
    setSubmitReady(false)
    const timer = setTimeout(() => setSubmitReady(true), SUBMIT_GRACE_PERIOD_MS)
    return () => clearTimeout(timer)
  }, [activeTab])

  const [formData, setFormData] = useState({
    // Basic Info
    name: '',
    pronouns: '',
    description: '',
    appearance: '',

    // Character Details
    personality: '',
    backstory: '',
    goals: '',
    currentLocation: '',
    // How familiar the character is with this world's systems — seeds
    // their knowledge-relative sheet (what renders vs. stays hidden).
    originFamiliarity: 'NATIVE' as 'NATIVE' | 'NEWCOMER' | 'OUTSIDER',

    // Stats & Moves
    stats: {
      cool: 0,
      hard: 0,
      hot: 0,
      sharp: 0,
      weird: 0,
    },
    moves: [] as string[],
    perks: [] as Array<{ id: string; name: string; description: string; tags?: string[] }>,

    // Equipment & Inventory
    equipment: {
      weapon: '',
      armor: '',
      misc: '',
    },
    inventory: {
      items: [] as Array<{ id: string; name: string; quantity: number; tags: string[] }>,
    },

    // Resources
    resources: {
      gold: 100,
      contacts: [] as string[],
    },

    // Consequences
    consequences: {
      promises: [] as string[],
      debts: [] as string[],
      enemies: [] as string[],
      longTermThreats: [] as string[],
    },
  })

  // Origin archetype cards — per-universe playbook presets generated at
  // campaign creation. Picking one pre-fills the wizard; "start from
  // scratch" always remains available (and is the only path for campaigns
  // whose generation produced no cards).
  interface ArchetypeCard {
    id: string
    name: string
    description: string
    originFamiliarity: 'NATIVE' | 'NEWCOMER' | 'OUTSIDER'
    suggestedStats: Record<string, number> | null
    startingGear: {
      weapon?: string
      armor?: string
      misc?: string
      items?: Array<{ name: string; quantity: number; tags: string[] }>
    } | null
    startingTie: { description?: string } | null
    backstoryPrompts: string[]
  }
  const [archetypes, setArchetypes] = useState<ArchetypeCard[]>([])
  const [selectedArchetypeId, setSelectedArchetypeId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    authenticatedFetch(`/api/campaigns/${campaignId}/archetypes`)
      .then(res => (res.ok ? res.json() : { archetypes: [] }))
      .then(data => {
        if (!cancelled) setArchetypes(data.archetypes || [])
      })
      .catch(() => {
        // No cards is a fully supported state — the blank wizard works.
      })
    return () => {
      cancelled = true
    }
  }, [campaignId])

  // Existing party locations — nothing keeps a new character's starting
  // location in sync with the rest of the party otherwise (each player
  // fills in this field independently), which is how a party ends up
  // accidentally split with no one having chosen that on purpose. A
  // single shared location auto-fills the field; a genuine split is
  // surfaced so the player can pick deliberately instead of by accident.
  const [partyLocations, setPartyLocations] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    authenticatedFetch(`/api/campaigns/${campaignId}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return
        const locations = [...new Set(
          (data.campaign?.characters || [])
            .map((c: any) => (c.currentLocation || '').trim())
            .filter(Boolean)
        )] as string[]
        setPartyLocations(locations)
        if (locations.length === 1) {
          setFormData(prev => (prev.currentLocation ? prev : { ...prev, currentLocation: locations[0] }))
        }
      })
      .catch(() => {
        // No hint is a fully supported state — the field just stays blank.
      })
    return () => {
      cancelled = true
    }
  }, [campaignId])

  const applyArchetype = (archetype: ArchetypeCard) => {
    setSelectedArchetypeId(archetype.id)
    setFormData(prev => ({
      ...prev,
      originFamiliarity: archetype.originFamiliarity,
      ...(archetype.suggestedStats
        ? { stats: { ...prev.stats, ...archetype.suggestedStats } }
        : {}),
      ...(archetype.startingGear
        ? {
            equipment: {
              weapon: archetype.startingGear.weapon || prev.equipment.weapon,
              armor: archetype.startingGear.armor || prev.equipment.armor,
              misc: archetype.startingGear.misc || prev.equipment.misc,
            },
            inventory: {
              ...prev.inventory,
              items: (archetype.startingGear.items || []).map((item, idx) => ({
                id: `archetype-${idx}-${Date.now()}`,
                name: item.name,
                quantity: item.quantity,
                tags: item.tags,
              })),
            },
          }
        : {}),
    }))
  }

  const clearArchetype = () => {
    setSelectedArchetypeId(null)
  }

  const selectedArchetype = archetypes.find(a => a.id === selectedArchetypeId) || null

  // Temporary input states
  const [newItemName, setNewItemName] = useState('')
  const [newItemQuantity, setNewItemQuantity] = useState(1)
  const [newItemTags, setNewItemTags] = useState('')
  const [newContact, setNewContact] = useState('')
  const [newPromise, setNewPromise] = useState('')
  const [newDebt, setNewDebt] = useState('')
  const [newEnemy, setNewEnemy] = useState('')

  const tabs = [
    { key: 'basics' as TabKey, label: 'Basic Info', icon: User },
    { key: 'character' as TabKey, label: 'Personality & Background', icon: BookOpen },
    { key: 'stats' as TabKey, label: 'Stats & Abilities', icon: Zap },
    { key: 'equipment' as TabKey, label: 'Equipment & Inventory', icon: Backpack },
    { key: 'resources' as TabKey, label: 'Resources & Contacts', icon: Coins },
    { key: 'consequences' as TabKey, label: 'Obligations & Rivals', icon: Swords },
  ]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError('')

    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/characters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          // Server-side archetype seeding: extra capability glimpses + the
          // starting tie (a Debt or faction standing) into the living world.
          archetypeId: selectedArchetypeId || undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create character')
      }

      router.refresh()
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleStatChange = (stat: string, value: number) => {
    setFormData(prev => ({
      ...prev,
      stats: {
        ...prev.stats,
        [stat]: value,
      },
    }))
  }

  const handleAddItem = () => {
    if (!newItemName.trim()) return

    const newItem = {
      id: Date.now().toString(),
      name: newItemName.trim(),
      quantity: newItemQuantity,
      tags: newItemTags ? newItemTags.split(',').map(t => t.trim()).filter(Boolean) : [],
    }

    setFormData(prev => ({
      ...prev,
      inventory: {
        ...prev.inventory,
        items: [...prev.inventory.items, newItem],
      },
    }))

    setNewItemName('')
    setNewItemQuantity(1)
    setNewItemTags('')
  }

  const handleRemoveItem = (itemId: string) => {
    setFormData(prev => ({
      ...prev,
      inventory: {
        ...prev.inventory,
        items: prev.inventory.items.filter(item => item.id !== itemId),
      },
    }))
  }

  const addQuickItem = (name: string, quantity: number = 1, tags: string[] = []) => {
    const newItem = {
      id: Date.now().toString() + Math.random(),
      name,
      quantity,
      tags,
    }

    setFormData(prev => ({
      ...prev,
      inventory: {
        ...prev.inventory,
        items: [...prev.inventory.items, newItem],
      },
    }))
  }

  const addContact = () => {
    if (!newContact.trim()) return
    setFormData(prev => ({
      ...prev,
      resources: {
        ...prev.resources,
        contacts: [...prev.resources.contacts, newContact.trim()],
      },
    }))
    setNewContact('')
  }

  const removeContact = (index: number) => {
    setFormData(prev => ({
      ...prev,
      resources: {
        ...prev.resources,
        contacts: prev.resources.contacts.filter((_, i) => i !== index),
      },
    }))
  }

  const addPromise = () => {
    if (!newPromise.trim()) return
    setFormData(prev => ({
      ...prev,
      consequences: {
        ...prev.consequences,
        promises: [...prev.consequences.promises, newPromise.trim()],
      },
    }))
    setNewPromise('')
  }

  const removePromise = (index: number) => {
    setFormData(prev => ({
      ...prev,
      consequences: {
        ...prev.consequences,
        promises: prev.consequences.promises.filter((_, i) => i !== index),
      },
    }))
  }

  const addDebt = () => {
    if (!newDebt.trim()) return
    setFormData(prev => ({
      ...prev,
      consequences: {
        ...prev.consequences,
        debts: [...prev.consequences.debts, newDebt.trim()],
      },
    }))
    setNewDebt('')
  }

  const removeDebt = (index: number) => {
    setFormData(prev => ({
      ...prev,
      consequences: {
        ...prev.consequences,
        debts: prev.consequences.debts.filter((_, i) => i !== index),
      },
    }))
  }

  const addEnemy = () => {
    if (!newEnemy.trim()) return
    setFormData(prev => ({
      ...prev,
      consequences: {
        ...prev.consequences,
        enemies: [...prev.consequences.enemies, newEnemy.trim()],
      },
    }))
    setNewEnemy('')
  }

  const removeEnemy = (index: number) => {
    setFormData(prev => ({
      ...prev,
      consequences: {
        ...prev.consequences,
        enemies: prev.consequences.enemies.filter((_, i) => i !== index),
      },
    }))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-myth-danger/10 border border-myth-danger/30 text-myth-danger p-4 rounded-md">
          {error}
        </div>
      )}

      <Tabs items={tabs} value={activeTab} onChange={setActiveTab} aria-label="Character sections" />

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {/* Basic Info Tab */}
        {activeTab === 'basics' && (
          <div className="space-y-4">
            {archetypes.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-myth-ink mb-1">
                  Choose an origin
                </label>
                <p className="text-xs text-myth-ink-faint mb-2">
                  Ready-to-play entry points into this world — picking one fills in stats, gear, and a starting
                  connection you can still tweak on the later tabs. Or build from scratch.
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  {archetypes.map(archetype => (
                    <button
                      key={archetype.id}
                      type="button"
                      onClick={() => applyArchetype(archetype)}
                      className={`text-left rounded-lg p-4 border transition-colors ${
                        selectedArchetypeId === archetype.id
                          ? 'bg-myth-accent/10 border-myth-accent'
                          : 'bg-myth-surface-sunken border-myth-border hover:border-myth-border-strong'
                      }`}
                    >
                      <div className="font-medium text-myth-ink-muted mb-1">{archetype.name}</div>
                      <p className="text-xs text-myth-ink-faint">{archetype.description}</p>
                      {archetype.startingTie?.description && (
                        <p className="text-xs text-myth-ink-faint mt-2 italic">Starts with: {archetype.startingTie.description}</p>
                      )}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={clearArchetype}
                    className={`text-left rounded-lg p-4 border border-dashed transition-colors ${
                      selectedArchetypeId === null
                        ? 'bg-myth-accent/10 border-myth-accent/50'
                        : 'border-myth-border hover:border-myth-border-strong'
                    }`}
                  >
                    <div className="font-medium text-myth-ink-muted mb-1">Start from scratch</div>
                    <p className="text-xs text-myth-ink-faint">Build every detail yourself.</p>
                  </button>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-myth-ink mb-1">
                Character Name <span className="text-myth-danger">*</span>
              </label>
              <Input
                type="text"
                id="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter your character's name"
              />
            </div>

            <div>
              <label htmlFor="pronouns" className="block text-sm font-medium text-myth-ink mb-1">
                Pronouns
              </label>
              <Input
                type="text"
                id="pronouns"
                value={formData.pronouns}
                onChange={(e) => setFormData({ ...formData, pronouns: e.target.value })}
                placeholder="e.g., they/them, she/her, he/him"
              />
            </div>

            <div>
              <label htmlFor="appearance" className="block text-sm font-medium text-myth-ink mb-1">
                Physical Appearance
              </label>
              <Textarea
                id="appearance"
                rows={3}
                value={formData.appearance}
                onChange={(e) => setFormData({ ...formData, appearance: e.target.value })}
                placeholder="Describe your character's physical appearance: height, build, hair, eyes, distinctive features, clothing style, etc."
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-myth-ink mb-1">
                General Description
              </label>
              <Textarea
                id="description"
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="A brief overview of your character: who they are, what they do, their general demeanor."
              />
            </div>

            <div>
              <label htmlFor="currentLocation" className="block text-sm font-medium text-myth-ink mb-1">
                Starting Location
              </label>
              <Input
                type="text"
                id="currentLocation"
                value={formData.currentLocation}
                onChange={(e) => setFormData({ ...formData, currentLocation: e.target.value })}
                placeholder="Where does your character begin their journey?"
              />
              <p className="text-xs text-myth-ink-faint mt-1">This will be used to personalize the opening scene.</p>
              {partyLocations.length === 1 && (
                <p className="text-xs text-myth-ink-faint mt-1">Your party is currently at: {partyLocations[0]}</p>
              )}
              {partyLocations.length > 1 && (
                <p className="text-xs text-myth-ink-faint mt-1">
                  Your party isn't in one place right now — pick a location to match one of them, or somewhere new if your character is arriving separately: {partyLocations.join(', ')}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Personality & Background Tab */}
        {activeTab === 'character' && (
          <div className="space-y-4">
            <div>
              <label htmlFor="personality" className="block text-sm font-medium text-myth-ink mb-1">
                Personality Traits
              </label>
              <Textarea
                id="personality"
                rows={3}
                value={formData.personality}
                onChange={(e) => setFormData({ ...formData, personality: e.target.value })}
                placeholder="How does your character act and think? Are they brave, cautious, witty, serious, compassionate, ruthless?"
              />
            </div>

            <div>
              <label htmlFor="originFamiliarity" className="block text-sm font-medium text-myth-ink mb-1">
                How well do they know this world?
              </label>
              <Select
                id="originFamiliarity"
                value={formData.originFamiliarity}
                onChange={(e) => setFormData({ ...formData, originFamiliarity: e.target.value as 'NATIVE' | 'NEWCOMER' | 'OUTSIDER' })}
              >
                <option value="NATIVE">Native — grew up here, knows what exists</option>
                <option value="NEWCOMER">Newcomer — heard of the big things, hazy on details</option>
                <option value="OUTSIDER">Outsider — a stranger to this world&apos;s ways entirely</option>
              </Select>
              <p className="text-xs text-myth-ink-muted mt-1">
                This shapes what appears on your character sheet. An outsider starts with a nearly blank sheet and discovers this world&apos;s powers, arts, and secrets through the story itself.
              </p>
            </div>

            <div>
              <label htmlFor="backstory" className="block text-sm font-medium text-myth-ink mb-1">
                Backstory
              </label>
              <Textarea
                id="backstory"
                rows={5}
                value={formData.backstory}
                onChange={(e) => setFormData({ ...formData, backstory: e.target.value })}
                placeholder="What is your character's history? Where did they come from? What important events shaped who they are today?"
              />
              {selectedArchetype && selectedArchetype.backstoryPrompts.length > 0 && (
                <div className="mt-2 text-xs text-myth-ink-faint bg-myth-surface-sunken rounded-md p-3 border border-myth-border">
                  <span className="font-medium text-myth-ink-faint">Questions to spark your {selectedArchetype.name} backstory:</span>
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    {selectedArchetype.backstoryPrompts.map((prompt, idx) => (
                      <li key={idx}>{prompt}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="goals" className="block text-sm font-medium text-myth-ink mb-1">
                Goals & Motivations
              </label>
              <Textarea
                id="goals"
                rows={3}
                value={formData.goals}
                onChange={(e) => setFormData({ ...formData, goals: e.target.value })}
                placeholder="What does your character want to achieve? What drives them forward?"
              />
            </div>
          </div>
        )}

        {/* Stats & Abilities Tab */}
        {activeTab === 'stats' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-myth-ink mb-2">
                Character Stats
              </label>
              <p className="text-xs text-myth-ink-faint mb-4">
                Range: -1 (weak) to +2 (strong). Most stats start at 0 or +1.
              </p>
              <div className="space-y-3">
                {Object.entries(formData.stats).map(([stat, value]) => {
                  const custom = statLabels?.[stat as keyof typeof PBTA_STATS]
                  return (
                    <div key={stat} className="bg-myth-surface-sunken rounded-md p-3 border border-myth-border">
                      <div className="flex items-center justify-between mb-1">
                        <label htmlFor={stat} className={`text-sm font-medium text-myth-ink ${custom ? '' : 'capitalize'}`}>
                          {custom?.label || stat}
                        </label>
                        <Input
                          wrapperClassName="w-16" className="text-center font-bold"
                          type="number"
                          id={stat}
                          min="-1"
                          max="2"
                          value={value}
                          onChange={(e) => handleStatChange(stat, parseInt(e.target.value) || 0)}
                        />
                      </div>
                      <p className="text-xs text-myth-ink-faint">
                        {custom?.description || PBTA_STATS[stat as keyof typeof PBTA_STATS]}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="bg-myth-accent/10 border border-myth-border-strong rounded-md p-4">
              <p className="text-sm text-myth-ink-muted">
                💡 <strong>Tip:</strong> Special moves and perks are earned during gameplay through character advancement and story progression.
              </p>
            </div>
          </div>
        )}

        {/* Equipment & Inventory Tab */}
        {activeTab === 'equipment' && (
          <div className="space-y-6">
            {/* Equipment Section */}
            <div>
              <h3 className="text-lg font-medium text-myth-ink mb-4">Equipment</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="weapon" className="block text-sm font-medium text-myth-ink mb-1">
                    Primary Weapon
                  </label>
                  <Input
                    type="text"
                    id="weapon"
                    value={formData.equipment.weapon}
                    onChange={(e) => setFormData({ ...formData, equipment: { ...formData.equipment, weapon: e.target.value } })}
                    placeholder="e.g., Rusty Sword, Laser Pistol, Wooden Staff"
                  />
                </div>

                <div>
                  <label htmlFor="armor" className="block text-sm font-medium text-myth-ink mb-1">
                    Armor / Protection
                  </label>
                  <Input
                    type="text"
                    id="armor"
                    value={formData.equipment.armor}
                    onChange={(e) => setFormData({ ...formData, equipment: { ...formData.equipment, armor: e.target.value } })}
                    placeholder="e.g., Leather Armor, Kevlar Vest, Enchanted Robes"
                  />
                </div>

                <div>
                  <label htmlFor="misc" className="block text-sm font-medium text-myth-ink mb-1">
                    Accessory / Misc. Equipment
                  </label>
                  <Input
                    type="text"
                    id="misc"
                    value={formData.equipment.misc}
                    onChange={(e) => setFormData({ ...formData, equipment: { ...formData.equipment, misc: e.target.value } })}
                    placeholder="e.g., Magic Amulet, Toolkit, Communicator"
                  />
                </div>
              </div>
            </div>

            {/* Inventory Section */}
            <div className="border-t border-myth-border pt-6">
              <h3 className="text-lg font-medium text-myth-ink mb-2">Starting Inventory</h3>
              <p className="text-xs text-myth-ink-faint mb-4">
                Add items your character starts with.
              </p>

              {/* Quick Add Buttons */}
              <div className="mb-4">
                <p className="text-xs font-medium text-myth-ink-muted mb-2">Quick Add Common Items:</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary" size="sm"
                    type="button"
                    onClick={() => addQuickItem('Rations', 3, ['consumable', 'food'])}
                    >
                    + Rations (3)
                  </Button>
                  <Button
                    variant="secondary" size="sm"
                    type="button"
                    onClick={() => addQuickItem('Rope (50ft)', 1, ['gear'])}
                    >
                    + Rope
                  </Button>
                  <Button
                    variant="secondary" size="sm"
                    type="button"
                    onClick={() => addQuickItem('Torch', 2, ['gear', 'light'])}
                    >
                    + Torches (2)
                  </Button>
                  <Button
                    variant="secondary" size="sm"
                    type="button"
                    onClick={() => addQuickItem('Health Potion', 2, ['consumable', 'healing'])}
                    >
                    + Health Potions (2)
                  </Button>
                  <Button
                    variant="secondary" size="sm"
                    type="button"
                    onClick={() => addQuickItem('Lockpicks', 1, ['tool'])}
                    >
                    + Lockpicks
                  </Button>
                </div>
              </div>

              {/* Current Items List */}
              {formData.inventory.items.length > 0 && (
                <div className="mb-4 space-y-2">
                  <p className="text-xs font-medium text-myth-ink-muted">Current Items:</p>
                  {formData.inventory.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between bg-myth-surface-sunken p-2 rounded border border-myth-border">
                      <div>
                        <span className="text-sm text-myth-ink">{item.name}</span>
                        {item.quantity > 1 && (
                          <span className="text-xs text-myth-ink-faint ml-2">x{item.quantity}</span>
                        )}
                        {item.tags.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {item.tags.map((tag, idx) => (
                              <span key={idx} className="text-xs px-1.5 py-0.5 bg-myth-surface border border-myth-border text-myth-ink-muted rounded">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="danger"
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* Custom Item Form */}
              <div className="bg-myth-surface-sunken p-4 rounded border border-myth-border space-y-3">
                <p className="text-sm font-medium text-myth-ink">Add Custom Item:</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <Input
                      type="text"
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      placeholder="Item name"
                    />
                  </div>
                  <div>
                    <Input
                      type="number"
                      min="1"
                      value={newItemQuantity}
                      onChange={(e) => setNewItemQuantity(parseInt(e.target.value) || 1)}
                      placeholder="Qty"
                    />
                  </div>
                </div>
                <div>
                  <Input
                    type="text"
                    value={newItemTags}
                    onChange={(e) => setNewItemTags(e.target.value)}
                    placeholder="Tags (comma-separated, e.g., weapon, magical)"
                  />
                </div>
                <Button
                  fullWidth
                  type="button"
                  onClick={handleAddItem}
                >
                  Add Item
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Resources & Contacts Tab */}
        {activeTab === 'resources' && (
          <div className="space-y-6">
            <div>
              <label htmlFor="gold" className="block text-sm font-medium text-myth-ink mb-1">
                Starting Gold / Currency
              </label>
              <Input
                wrapperClassName="w-48"
                type="number"
                id="gold"
                min="0"
                value={formData.resources.gold}
                onChange={(e) => setFormData({ ...formData, resources: { ...formData.resources, gold: parseInt(e.target.value) || 0 } })}
              />
              <p className="text-xs text-myth-ink-faint mt-1">Starting wealth for your character.</p>
            </div>

            <div className="border-t border-myth-border pt-6">
              <h3 className="text-lg font-medium text-myth-ink mb-2">Contacts & Allies</h3>
              <p className="text-xs text-myth-ink-faint mb-4">
                People your character knows and can call upon for help, information, or favors.
              </p>

              {formData.resources.contacts.length > 0 && (
                <div className="mb-4 space-y-2">
                  {formData.resources.contacts.map((contact, index) => (
                    <div key={index} className="flex items-center justify-between bg-myth-surface-sunken p-2 rounded border border-myth-border">
                      <span className="text-sm text-myth-ink">{contact}</span>
                      <Button
                        variant="danger"
                        type="button"
                        onClick={() => removeContact(index)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  wrapperClassName="flex-1"
                  type="text"
                  value={newContact}
                  onChange={(e) => setNewContact(e.target.value)}
                  placeholder="e.g., Marcus the Fence, Elena the Informant"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addContact())}
                />
                <Button
                  type="button"
                  onClick={addContact}
                >
                  Add Contact
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Obligations & Rivals Tab */}
        {activeTab === 'consequences' && (
          <div className="space-y-6">
            <div className="bg-myth-accent/10 border border-myth-border-strong rounded-md p-4">
              <p className="text-sm text-myth-ink-muted">
                ⚠️ <strong>Note:</strong> These elements create personal stakes and drama. MythOS will incorporate them into your story to create compelling narrative tension.
              </p>
            </div>

            {/* Promises */}
            <div>
              <h3 className="text-lg font-medium text-myth-ink mb-2">Promises Made</h3>
              <p className="text-xs text-myth-ink-faint mb-4">
                Commitments your character has made that they must honor.
              </p>

              {formData.consequences.promises.length > 0 && (
                <div className="mb-4 space-y-2">
                  {formData.consequences.promises.map((promise, index) => (
                    <div key={index} className="flex items-center justify-between bg-myth-surface-sunken p-2 rounded border border-myth-border">
                      <span className="text-sm text-myth-ink">{promise}</span>
                      <Button
                        variant="danger"
                        type="button"
                        onClick={() => removePromise(index)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  wrapperClassName="flex-1"
                  type="text"
                  value={newPromise}
                  onChange={(e) => setNewPromise(e.target.value)}
                  placeholder="e.g., Promised to protect the village, Swore an oath to the King"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addPromise())}
                />
                <Button
                  type="button"
                  onClick={addPromise}
                >
                  Add Promise
                </Button>
              </div>
            </div>

            {/* Debts */}
            <div className="border-t border-myth-border pt-6">
              <h3 className="text-lg font-medium text-myth-ink mb-2">Debts Owed</h3>
              <p className="text-xs text-myth-ink-faint mb-4">
                What does your character owe to others? Money, favors, life debts?
              </p>

              {formData.consequences.debts.length > 0 && (
                <div className="mb-4 space-y-2">
                  {formData.consequences.debts.map((debt, index) => (
                    <div key={index} className="flex items-center justify-between bg-myth-surface-sunken p-2 rounded border border-myth-border">
                      <span className="text-sm text-myth-ink">{debt}</span>
                      <Button
                        variant="danger"
                        type="button"
                        onClick={() => removeDebt(index)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  wrapperClassName="flex-1"
                  type="text"
                  value={newDebt}
                  onChange={(e) => setNewDebt(e.target.value)}
                  placeholder="e.g., Owes 500 gold to the Thieves' Guild, Life debt to a mysterious wizard"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addDebt())}
                />
                <Button
                  type="button"
                  onClick={addDebt}
                >
                  Add Debt
                </Button>
              </div>
            </div>

            {/* Enemies */}
            <div className="border-t border-myth-border pt-6">
              <h3 className="text-lg font-medium text-myth-ink mb-2">Enemies & Rivals</h3>
              <p className="text-xs text-myth-ink-faint mb-4">
                Who wants to see your character fail or suffer? Past conflicts that may resurface?
              </p>

              {formData.consequences.enemies.length > 0 && (
                <div className="mb-4 space-y-2">
                  {formData.consequences.enemies.map((enemy, index) => (
                    <div key={index} className="flex items-center justify-between bg-myth-surface-sunken p-2 rounded border border-myth-border">
                      <span className="text-sm text-myth-ink">{enemy}</span>
                      <Button
                        variant="danger"
                        type="button"
                        onClick={() => removeEnemy(index)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  wrapperClassName="flex-1"
                  type="text"
                  value={newEnemy}
                  onChange={(e) => setNewEnemy(e.target.value)}
                  placeholder="e.g., The Shadow Guild, Lord Blackwood, Former mentor turned villain"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addEnemy())}
                />
                <Button
                  type="button"
                  onClick={addEnemy}
                >
                  Add Enemy
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Form Actions */}
      <div className="flex justify-between items-center pt-6 border-t border-myth-border">
        <div className="text-sm text-myth-ink-faint">
          {activeTab !== 'basics' && (
            <Button
              variant="ghost"
              size="sm"
              icon={ArrowLeft}
              type="button"
              onClick={() => {
                const currentIndex = tabs.findIndex(t => t.key === activeTab)
                if (currentIndex > 0) setActiveTab(tabs[currentIndex - 1].key)
              }}
            >
              Previous
            </Button>
          )}
        </div>

        <div className="flex space-x-3">
          {onCancel && (
            <Button
              variant="secondary"
              type="button"
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
          {activeTab !== 'consequences' ? (
            <Button
              type="button"
              iconRight={ArrowRight}
              onClick={() => {
                const currentIndex = tabs.findIndex(t => t.key === activeTab)
                if (currentIndex < tabs.length - 1) setActiveTab(tabs[currentIndex + 1].key)
              }}
            >
              Next
            </Button>
          ) : (
            <Button
              type="submit"
              loading={isSubmitting}
              disabled={!submitReady}
            >
              {isSubmitting ? 'Creating Character…' : 'Create Character'}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
