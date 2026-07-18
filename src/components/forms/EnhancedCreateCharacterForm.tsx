// src/components/forms/EnhancedCreateCharacterForm.tsx
// Tabbed character creation form with comprehensive fields

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { authenticatedFetch } from '@/lib/clientAuth'
import { PBTA_STATS } from '@/lib/pbta-moves'

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
      slots: 10,
    },

    // Resources
    resources: {
      gold: 100,
      contacts: [] as string[],
      reputation: {} as Record<string, number>,
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
    { key: 'basics' as TabKey, label: 'Basic Info', icon: '👤' },
    { key: 'character' as TabKey, label: 'Personality & Background', icon: '📖' },
    { key: 'stats' as TabKey, label: 'Stats & Abilities', icon: '⚡' },
    { key: 'equipment' as TabKey, label: 'Equipment & Inventory', icon: '🎒' },
    { key: 'resources' as TabKey, label: 'Resources & Contacts', icon: '💰' },
    { key: 'consequences' as TabKey, label: 'Obligations & Rivals', icon: '⚔️' },
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
        <div className="bg-wine-800/20 border border-wine-600/50 text-wine-400 p-4 rounded-md">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-ember-900/30">
        <nav className="flex space-x-4 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors whitespace-nowrap flex items-center gap-2 ${
                activeTab === tab.key
                  ? 'border-ember-400 text-ember-300'
                  : 'border-transparent text-ember-300/60 hover:text-ember-200/80 hover:border-ember-900/40'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {/* Basic Info Tab */}
        {activeTab === 'basics' && (
          <div className="space-y-4">
            {archetypes.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-ember-100 mb-1">
                  Choose an origin
                </label>
                <p className="text-xs text-ember-300/60 mb-2">
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
                          ? 'bg-ember-900/30 border-ember-500/60'
                          : 'bg-black/25 border-ember-900/30 hover:border-ember-700/50'
                      }`}
                    >
                      <div className="font-medium text-ember-200 mb-1">{archetype.name}</div>
                      <p className="text-xs text-ember-300/60">{archetype.description}</p>
                      {archetype.startingTie?.description && (
                        <p className="text-xs text-ember-400/50 mt-2 italic">Starts with: {archetype.startingTie.description}</p>
                      )}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={clearArchetype}
                    className={`text-left rounded-lg p-4 border border-dashed transition-colors ${
                      selectedArchetypeId === null
                        ? 'bg-ember-900/20 border-ember-500/50'
                        : 'border-ember-900/40 hover:border-ember-700/50'
                    }`}
                  >
                    <div className="font-medium text-ember-300/80 mb-1">Start from scratch</div>
                    <p className="text-xs text-ember-300/50">Build every detail yourself.</p>
                  </button>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-ember-100 mb-1">
                Character Name <span className="text-wine-400">*</span>
              </label>
              <input
                type="text"
                id="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="input-field"
                placeholder="Enter your character's name"
              />
            </div>

            <div>
              <label htmlFor="pronouns" className="block text-sm font-medium text-ember-100 mb-1">
                Pronouns
              </label>
              <input
                type="text"
                id="pronouns"
                value={formData.pronouns}
                onChange={(e) => setFormData({ ...formData, pronouns: e.target.value })}
                className="input-field"
                placeholder="e.g., they/them, she/her, he/him"
              />
            </div>

            <div>
              <label htmlFor="appearance" className="block text-sm font-medium text-ember-100 mb-1">
                Physical Appearance
              </label>
              <textarea
                id="appearance"
                rows={3}
                value={formData.appearance}
                onChange={(e) => setFormData({ ...formData, appearance: e.target.value })}
                className="input-field"
                placeholder="Describe your character's physical appearance: height, build, hair, eyes, distinctive features, clothing style, etc."
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-ember-100 mb-1">
                General Description
              </label>
              <textarea
                id="description"
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="input-field"
                placeholder="A brief overview of your character: who they are, what they do, their general demeanor."
              />
            </div>

            <div>
              <label htmlFor="currentLocation" className="block text-sm font-medium text-ember-100 mb-1">
                Starting Location
              </label>
              <input
                type="text"
                id="currentLocation"
                value={formData.currentLocation}
                onChange={(e) => setFormData({ ...formData, currentLocation: e.target.value })}
                className="input-field"
                placeholder="Where does your character begin their journey?"
              />
              <p className="text-xs text-ember-300/60 mt-1">This will be used to personalize the opening scene.</p>
            </div>
          </div>
        )}

        {/* Personality & Background Tab */}
        {activeTab === 'character' && (
          <div className="space-y-4">
            <div>
              <label htmlFor="personality" className="block text-sm font-medium text-ember-100 mb-1">
                Personality Traits
              </label>
              <textarea
                id="personality"
                rows={3}
                value={formData.personality}
                onChange={(e) => setFormData({ ...formData, personality: e.target.value })}
                className="input-field"
                placeholder="How does your character act and think? Are they brave, cautious, witty, serious, compassionate, ruthless?"
              />
            </div>

            <div>
              <label htmlFor="originFamiliarity" className="block text-sm font-medium text-ember-100 mb-1">
                How well do they know this world?
              </label>
              <select
                id="originFamiliarity"
                value={formData.originFamiliarity}
                onChange={(e) => setFormData({ ...formData, originFamiliarity: e.target.value as 'NATIVE' | 'NEWCOMER' | 'OUTSIDER' })}
                className="input-field"
              >
                <option value="NATIVE">Native — grew up here, knows what exists</option>
                <option value="NEWCOMER">Newcomer — heard of the big things, hazy on details</option>
                <option value="OUTSIDER">Outsider — a stranger to this world&apos;s ways entirely</option>
              </select>
              <p className="text-xs text-ember-300 mt-1">
                This shapes what appears on your character sheet. An outsider starts with a nearly blank sheet and discovers this world&apos;s powers, arts, and secrets through the story itself.
              </p>
            </div>

            <div>
              <label htmlFor="backstory" className="block text-sm font-medium text-ember-100 mb-1">
                Backstory
              </label>
              <textarea
                id="backstory"
                rows={5}
                value={formData.backstory}
                onChange={(e) => setFormData({ ...formData, backstory: e.target.value })}
                className="input-field"
                placeholder="What is your character's history? Where did they come from? What important events shaped who they are today?"
              />
              {selectedArchetype && selectedArchetype.backstoryPrompts.length > 0 && (
                <div className="mt-2 text-xs text-ember-300/60 bg-black/20 rounded-md p-3 border border-ember-900/30">
                  <span className="font-medium text-ember-300/80">Questions to spark your {selectedArchetype.name} backstory:</span>
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    {selectedArchetype.backstoryPrompts.map((prompt, idx) => (
                      <li key={idx}>{prompt}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="goals" className="block text-sm font-medium text-ember-100 mb-1">
                Goals & Motivations
              </label>
              <textarea
                id="goals"
                rows={3}
                value={formData.goals}
                onChange={(e) => setFormData({ ...formData, goals: e.target.value })}
                className="input-field"
                placeholder="What does your character want to achieve? What drives them forward?"
              />
            </div>
          </div>
        )}

        {/* Stats & Abilities Tab */}
        {activeTab === 'stats' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ember-100 mb-2">
                Character Stats
              </label>
              <p className="text-xs text-ember-300/60 mb-4">
                Range: -1 (weak) to +2 (strong). Most stats start at 0 or +1.
              </p>
              <div className="space-y-3">
                {Object.entries(formData.stats).map(([stat, value]) => {
                  const custom = statLabels?.[stat as keyof typeof PBTA_STATS]
                  return (
                    <div key={stat} className="bg-black/25 rounded-md p-3 border border-ember-900/30">
                      <div className="flex items-center justify-between mb-1">
                        <label htmlFor={stat} className={`text-sm font-medium text-white ${custom ? '' : 'capitalize'}`}>
                          {custom?.label || stat}
                        </label>
                        <input
                          type="number"
                          id={stat}
                          min="-1"
                          max="2"
                          value={value}
                          onChange={(e) => handleStatChange(stat, parseInt(e.target.value) || 0)}
                          className="w-16 text-center rounded-md bg-black/30 border-ember-900/40 text-white shadow-sm focus:border-ember-400 focus:ring-ember-500/40 sm:text-sm font-bold"
                        />
                      </div>
                      <p className="text-xs text-ember-300/60">
                        {custom?.description || PBTA_STATS[stat as keyof typeof PBTA_STATS]}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="bg-ember-900/20 border border-ember-700/40 rounded-md p-4">
              <p className="text-sm text-ember-300">
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
              <h3 className="text-lg font-medium text-ember-100 mb-4">Equipment</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="weapon" className="block text-sm font-medium text-ember-100 mb-1">
                    Primary Weapon
                  </label>
                  <input
                    type="text"
                    id="weapon"
                    value={formData.equipment.weapon}
                    onChange={(e) => setFormData({ ...formData, equipment: { ...formData.equipment, weapon: e.target.value } })}
                    className="input-field"
                    placeholder="e.g., Rusty Sword, Laser Pistol, Wooden Staff"
                  />
                </div>

                <div>
                  <label htmlFor="armor" className="block text-sm font-medium text-ember-100 mb-1">
                    Armor / Protection
                  </label>
                  <input
                    type="text"
                    id="armor"
                    value={formData.equipment.armor}
                    onChange={(e) => setFormData({ ...formData, equipment: { ...formData.equipment, armor: e.target.value } })}
                    className="input-field"
                    placeholder="e.g., Leather Armor, Kevlar Vest, Enchanted Robes"
                  />
                </div>

                <div>
                  <label htmlFor="misc" className="block text-sm font-medium text-ember-100 mb-1">
                    Accessory / Misc. Equipment
                  </label>
                  <input
                    type="text"
                    id="misc"
                    value={formData.equipment.misc}
                    onChange={(e) => setFormData({ ...formData, equipment: { ...formData.equipment, misc: e.target.value } })}
                    className="input-field"
                    placeholder="e.g., Magic Amulet, Toolkit, Communicator"
                  />
                </div>
              </div>
            </div>

            {/* Inventory Section */}
            <div className="border-t border-ember-900/30 pt-6">
              <h3 className="text-lg font-medium text-ember-100 mb-2">Starting Inventory</h3>
              <p className="text-xs text-ember-300/60 mb-4">
                Add items your character starts with. Inventory slots: {formData.inventory.slots}
              </p>

              {/* Quick Add Buttons */}
              <div className="mb-4">
                <p className="text-xs font-medium text-ember-200/80 mb-2">Quick Add Common Items:</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => addQuickItem('Rations', 3, ['consumable', 'food'])}
                    className="btn-secondary text-xs"
                  >
                    + Rations (3)
                  </button>
                  <button
                    type="button"
                    onClick={() => addQuickItem('Rope (50ft)', 1, ['gear'])}
                    className="btn-secondary text-xs"
                  >
                    + Rope
                  </button>
                  <button
                    type="button"
                    onClick={() => addQuickItem('Torch', 2, ['gear', 'light'])}
                    className="btn-secondary text-xs"
                  >
                    + Torches (2)
                  </button>
                  <button
                    type="button"
                    onClick={() => addQuickItem('Health Potion', 2, ['consumable', 'healing'])}
                    className="btn-secondary text-xs"
                  >
                    + Health Potions (2)
                  </button>
                  <button
                    type="button"
                    onClick={() => addQuickItem('Lockpicks', 1, ['tool'])}
                    className="btn-secondary text-xs"
                  >
                    + Lockpicks
                  </button>
                </div>
              </div>

              {/* Current Items List */}
              {formData.inventory.items.length > 0 && (
                <div className="mb-4 space-y-2">
                  <p className="text-xs font-medium text-ember-200/80">Current Items:</p>
                  {formData.inventory.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between bg-black/25 p-2 rounded border border-ember-900/30">
                      <div>
                        <span className="text-sm text-white">{item.name}</span>
                        {item.quantity > 1 && (
                          <span className="text-xs text-ember-300/60 ml-2">x{item.quantity}</span>
                        )}
                        {item.tags.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {item.tags.map((tag, idx) => (
                              <span key={idx} className="text-xs px-1.5 py-0.5 bg-black/30 text-ember-200/80 rounded">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                        className="text-wine-400 hover:text-wine-300 text-sm"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Custom Item Form */}
              <div className="bg-black/25 p-4 rounded border border-ember-900/30 space-y-3">
                <p className="text-sm font-medium text-ember-100">Add Custom Item:</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <input
                      type="text"
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      placeholder="Item name"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <input
                      type="number"
                      min="1"
                      value={newItemQuantity}
                      onChange={(e) => setNewItemQuantity(parseInt(e.target.value) || 1)}
                      placeholder="Qty"
                      className="input-field"
                    />
                  </div>
                </div>
                <div>
                  <input
                    type="text"
                    value={newItemTags}
                    onChange={(e) => setNewItemTags(e.target.value)}
                    placeholder="Tags (comma-separated, e.g., weapon, magical)"
                    className="input-field"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="btn-primary w-full"
                >
                  Add Item
                </button>
              </div>

              <div className="mt-4">
                <label htmlFor="inventorySlots" className="block text-sm font-medium text-ember-100 mb-1">
                  Inventory Capacity (Slots)
                </label>
                <input
                  type="number"
                  id="inventorySlots"
                  min="5"
                  max="20"
                  value={formData.inventory.slots}
                  onChange={(e) => setFormData({ ...formData, inventory: { ...formData.inventory, slots: parseInt(e.target.value) || 10 } })}
                  className="input-field w-32"
                />
                <p className="text-xs text-ember-300/60 mt-1">Maximum number of items you can carry.</p>
              </div>
            </div>
          </div>
        )}

        {/* Resources & Contacts Tab */}
        {activeTab === 'resources' && (
          <div className="space-y-6">
            <div>
              <label htmlFor="gold" className="block text-sm font-medium text-ember-100 mb-1">
                Starting Gold / Currency
              </label>
              <input
                type="number"
                id="gold"
                min="0"
                value={formData.resources.gold}
                onChange={(e) => setFormData({ ...formData, resources: { ...formData.resources, gold: parseInt(e.target.value) || 0 } })}
                className="input-field w-48"
              />
              <p className="text-xs text-ember-300/60 mt-1">Starting wealth for your character.</p>
            </div>

            <div className="border-t border-ember-900/30 pt-6">
              <h3 className="text-lg font-medium text-ember-100 mb-2">Contacts & Allies</h3>
              <p className="text-xs text-ember-300/60 mb-4">
                People your character knows and can call upon for help, information, or favors.
              </p>

              {formData.resources.contacts.length > 0 && (
                <div className="mb-4 space-y-2">
                  {formData.resources.contacts.map((contact, index) => (
                    <div key={index} className="flex items-center justify-between bg-black/25 p-2 rounded border border-ember-900/30">
                      <span className="text-sm text-white">{contact}</span>
                      <button
                        type="button"
                        onClick={() => removeContact(index)}
                        className="text-wine-400 hover:text-wine-300 text-sm"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newContact}
                  onChange={(e) => setNewContact(e.target.value)}
                  placeholder="e.g., Marcus the Fence, Elena the Informant"
                  className="input-field flex-1"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addContact())}
                />
                <button
                  type="button"
                  onClick={addContact}
                  className="btn-primary"
                >
                  Add Contact
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Obligations & Rivals Tab */}
        {activeTab === 'consequences' && (
          <div className="space-y-6">
            <div className="bg-ember-900/15 border border-ember-700/40 rounded-md p-4">
              <p className="text-sm text-ember-300">
                ⚠️ <strong>Note:</strong> These elements create personal stakes and drama. The AI GM will incorporate them into your story to create compelling narrative tension.
              </p>
            </div>

            {/* Promises */}
            <div>
              <h3 className="text-lg font-medium text-ember-100 mb-2">Promises Made</h3>
              <p className="text-xs text-ember-300/60 mb-4">
                Commitments your character has made that they must honor.
              </p>

              {formData.consequences.promises.length > 0 && (
                <div className="mb-4 space-y-2">
                  {formData.consequences.promises.map((promise, index) => (
                    <div key={index} className="flex items-center justify-between bg-black/25 p-2 rounded border border-ember-900/30">
                      <span className="text-sm text-white">{promise}</span>
                      <button
                        type="button"
                        onClick={() => removePromise(index)}
                        className="text-wine-400 hover:text-wine-300 text-sm"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPromise}
                  onChange={(e) => setNewPromise(e.target.value)}
                  placeholder="e.g., Promised to protect the village, Swore an oath to the King"
                  className="input-field flex-1"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addPromise())}
                />
                <button
                  type="button"
                  onClick={addPromise}
                  className="btn-primary"
                >
                  Add Promise
                </button>
              </div>
            </div>

            {/* Debts */}
            <div className="border-t border-ember-900/30 pt-6">
              <h3 className="text-lg font-medium text-ember-100 mb-2">Debts Owed</h3>
              <p className="text-xs text-ember-300/60 mb-4">
                What does your character owe to others? Money, favors, life debts?
              </p>

              {formData.consequences.debts.length > 0 && (
                <div className="mb-4 space-y-2">
                  {formData.consequences.debts.map((debt, index) => (
                    <div key={index} className="flex items-center justify-between bg-black/25 p-2 rounded border border-ember-900/30">
                      <span className="text-sm text-white">{debt}</span>
                      <button
                        type="button"
                        onClick={() => removeDebt(index)}
                        className="text-wine-400 hover:text-wine-300 text-sm"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newDebt}
                  onChange={(e) => setNewDebt(e.target.value)}
                  placeholder="e.g., Owes 500 gold to the Thieves' Guild, Life debt to a mysterious wizard"
                  className="input-field flex-1"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addDebt())}
                />
                <button
                  type="button"
                  onClick={addDebt}
                  className="btn-primary"
                >
                  Add Debt
                </button>
              </div>
            </div>

            {/* Enemies */}
            <div className="border-t border-ember-900/30 pt-6">
              <h3 className="text-lg font-medium text-ember-100 mb-2">Enemies & Rivals</h3>
              <p className="text-xs text-ember-300/60 mb-4">
                Who wants to see your character fail or suffer? Past conflicts that may resurface?
              </p>

              {formData.consequences.enemies.length > 0 && (
                <div className="mb-4 space-y-2">
                  {formData.consequences.enemies.map((enemy, index) => (
                    <div key={index} className="flex items-center justify-between bg-black/25 p-2 rounded border border-ember-900/30">
                      <span className="text-sm text-white">{enemy}</span>
                      <button
                        type="button"
                        onClick={() => removeEnemy(index)}
                        className="text-wine-400 hover:text-wine-300 text-sm"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newEnemy}
                  onChange={(e) => setNewEnemy(e.target.value)}
                  placeholder="e.g., The Shadow Guild, Lord Blackwood, Former mentor turned villain"
                  className="input-field flex-1"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addEnemy())}
                />
                <button
                  type="button"
                  onClick={addEnemy}
                  className="btn-primary"
                >
                  Add Enemy
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Form Actions */}
      <div className="flex justify-between items-center pt-6 border-t border-ember-900/30">
        <div className="text-sm text-ember-300/60">
          {activeTab !== 'basics' && (
            <button
              type="button"
              onClick={() => {
                const currentIndex = tabs.findIndex(t => t.key === activeTab)
                if (currentIndex > 0) setActiveTab(tabs[currentIndex - 1].key)
              }}
              className="text-ember-300 hover:text-ember-200"
            >
              ← Previous
            </button>
          )}
        </div>

        <div className="flex space-x-3">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="btn-secondary"
            >
              Cancel
            </button>
          )}
          {activeTab !== 'consequences' ? (
            <button
              type="button"
              onClick={() => {
                const currentIndex = tabs.findIndex(t => t.key === activeTab)
                if (currentIndex < tabs.length - 1) setActiveTab(tabs[currentIndex + 1].key)
              }}
              className="btn-primary"
            >
              Next →
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSubmitting || !submitReady}
              className="btn-primary disabled:opacity-50"
            >
              {isSubmitting ? 'Creating Character...' : 'Create Character'}
            </button>
          )}
        </div>
      </div>
    </form>
  )
}
