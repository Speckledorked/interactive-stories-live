// src/components/CreateCharacterForm.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authenticatedFetch } from '@/lib/clientAuth'
import { PBTA_STATS } from '@/lib/pbta-moves'

interface CreateCharacterFormProps {
  campaignId: string
  onSuccess?: () => void
  onCancel?: () => void
}

function CreateCharacterForm({ 
  campaignId, 
  onSuccess, 
  onCancel 
}: CreateCharacterFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [formData, setFormData] = useState({
    name: '',
    pronouns: '',
    description: '',
    backstory: '',
    goals: '',
    currentLocation: '',
    stats: {
      cool: 0,
      hard: 0,
      hot: 0,
      sharp: 0,
      weird: 0,
    },
    equipment: {
      weapon: '',
      armor: '',
      misc: '',
    },
    inventory: {
      items: [] as Array<{ id: string; name: string; quantity: number; tags: string[] }>,
      slots: 10,
    },
    resources: {
      gold: 100,
    },
  })

  const [newItemName, setNewItemName] = useState('')
  const [newItemQuantity, setNewItemQuantity] = useState(1)
  const [newItemTags, setNewItemTags] = useState('')

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
        body: JSON.stringify(formData),
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-900/20 border border-red-500 text-red-400 p-4 rounded-md">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-200 mb-1">
          Character Name *
        </label>
        <input
          type="text"
          id="name"
          required
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="mt-1 block w-full rounded-md bg-gray-800 border-gray-700 text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm placeholder:text-gray-500"
          placeholder="Enter character name"
        />
      </div>

      <div>
        <label htmlFor="pronouns" className="block text-sm font-medium text-gray-200 mb-1">
          Pronouns
        </label>
        <input
          type="text"
          id="pronouns"
          value={formData.pronouns}
          onChange={(e) => setFormData({ ...formData, pronouns: e.target.value })}
          className="mt-1 block w-full rounded-md bg-gray-800 border-gray-700 text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm placeholder:text-gray-500"
          placeholder="e.g., they/them, she/her, he/him"
        />
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-200 mb-1">
          Description
        </label>
        <textarea
          id="description"
          rows={3}
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="mt-1 block w-full rounded-md bg-gray-800 border-gray-700 text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm placeholder:text-gray-500"
          placeholder="Physical appearance, personality traits, etc."
        />
      </div>

      <div>
        <label htmlFor="backstory" className="block text-sm font-medium text-gray-200 mb-1">
          Backstory
        </label>
        <textarea
          id="backstory"
          rows={4}
          value={formData.backstory}
          onChange={(e) => setFormData({ ...formData, backstory: e.target.value })}
          className="mt-1 block w-full rounded-md bg-gray-800 border-gray-700 text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm placeholder:text-gray-500"
          placeholder="Character history and background"
        />
      </div>

      <div>
        <label htmlFor="goals" className="block text-sm font-medium text-gray-200 mb-1">
          Goals
        </label>
        <textarea
          id="goals"
          rows={2}
          value={formData.goals}
          onChange={(e) => setFormData({ ...formData, goals: e.target.value })}
          className="mt-1 block w-full rounded-md bg-gray-800 border-gray-700 text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm placeholder:text-gray-500"
          placeholder="What does your character want to achieve?"
        />
      </div>

      <div>
        <label htmlFor="currentLocation" className="block text-sm font-medium text-gray-200 mb-1">
          Starting Location
        </label>
        <input
          type="text"
          id="currentLocation"
          value={formData.currentLocation}
          onChange={(e) => setFormData({ ...formData, currentLocation: e.target.value })}
          className="mt-1 block w-full rounded-md bg-gray-800 border-gray-700 text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm placeholder:text-gray-500"
          placeholder="Where does your character begin?"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-200 mb-2">
          Character Stats (PbtA)
        </label>
        <p className="text-xs text-gray-400 mb-3">
          Range: -1 (weak) to +2 (strong). Most stats start at 0.
        </p>
        <div className="space-y-3">
          {Object.entries(formData.stats).map(([stat, value]) => (
            <div key={stat} className="bg-gray-800 rounded-md p-3 border border-gray-700">
              <div className="flex items-center justify-between mb-1">
                <label htmlFor={stat} className="text-sm font-medium capitalize text-white">
                  {stat}
                </label>
                <input
                  type="number"
                  id={stat}
                  min="-1"
                  max="2"
                  value={value}
                  onChange={(e) => handleStatChange(stat, parseInt(e.target.value) || 0)}
                  className="w-16 text-center rounded-md bg-gray-900 border-gray-600 text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm font-bold"
                />
              </div>
              <p className="text-xs text-gray-400">
                {PBTA_STATS[stat as keyof typeof PBTA_STATS]}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Equipment Section */}
      <div className="border-t border-gray-700 pt-6">
        <h3 className="text-lg font-medium text-gray-200 mb-4">Equipment</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="weapon" className="block text-sm font-medium text-gray-200 mb-1">
              Weapon
            </label>
            <input
              type="text"
              id="weapon"
              value={formData.equipment.weapon}
              onChange={(e) => setFormData({ ...formData, equipment: { ...formData.equipment, weapon: e.target.value } })}
              className="mt-1 block w-full rounded-md bg-gray-800 border-gray-700 text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm placeholder:text-gray-500"
              placeholder="e.g., Rusty Sword, Laser Pistol, Staff"
            />
          </div>

          <div>
            <label htmlFor="armor" className="block text-sm font-medium text-gray-200 mb-1">
              Armor
            </label>
            <input
              type="text"
              id="armor"
              value={formData.equipment.armor}
              onChange={(e) => setFormData({ ...formData, equipment: { ...formData.equipment, armor: e.target.value } })}
              className="mt-1 block w-full rounded-md bg-gray-800 border-gray-700 text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm placeholder:text-gray-500"
              placeholder="e.g., Leather Armor, Kevlar Vest, Robes"
            />
          </div>

          <div>
            <label htmlFor="misc" className="block text-sm font-medium text-gray-200 mb-1">
              Accessory/Misc
            </label>
            <input
              type="text"
              id="misc"
              value={formData.equipment.misc}
              onChange={(e) => setFormData({ ...formData, equipment: { ...formData.equipment, misc: e.target.value } })}
              className="mt-1 block w-full rounded-md bg-gray-800 border-gray-700 text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm placeholder:text-gray-500"
              placeholder="e.g., Amulet, Toolkit, Communicator"
            />
          </div>
        </div>
      </div>

      {/* Inventory Section */}
      <div className="border-t border-gray-700 pt-6">
        <h3 className="text-lg font-medium text-gray-200 mb-2">Starting Inventory</h3>
        <p className="text-xs text-gray-400 mb-4">
          Add items your character starts with. Inventory slots: {formData.inventory.slots}
        </p>

        {/* Quick Add Buttons */}
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-300 mb-2">Quick Add:</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => addQuickItem('Rations', 3, ['consumable', 'food'])}
              className="px-2 py-1 text-xs bg-gray-700 text-gray-200 rounded hover:bg-gray-600"
            >
              + Rations (3)
            </button>
            <button
              type="button"
              onClick={() => addQuickItem('Rope (50ft)', 1, ['gear'])}
              className="px-2 py-1 text-xs bg-gray-700 text-gray-200 rounded hover:bg-gray-600"
            >
              + Rope
            </button>
            <button
              type="button"
              onClick={() => addQuickItem('Torch', 2, ['gear', 'light'])}
              className="px-2 py-1 text-xs bg-gray-700 text-gray-200 rounded hover:bg-gray-600"
            >
              + Torches (2)
            </button>
            <button
              type="button"
              onClick={() => addQuickItem('Health Potion', 2, ['consumable', 'healing'])}
              className="px-2 py-1 text-xs bg-gray-700 text-gray-200 rounded hover:bg-gray-600"
            >
              + Health Potions (2)
            </button>
            <button
              type="button"
              onClick={() => addQuickItem('Lockpicks', 1, ['tool'])}
              className="px-2 py-1 text-xs bg-gray-700 text-gray-200 rounded hover:bg-gray-600"
            >
              + Lockpicks
            </button>
          </div>
        </div>

        {/* Current Items List */}
        {formData.inventory.items.length > 0 && (
          <div className="mb-4 space-y-2">
            <p className="text-xs font-medium text-gray-300">Current Items:</p>
            {formData.inventory.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between bg-gray-800 p-2 rounded border border-gray-700">
                <div>
                  <span className="text-sm text-white">{item.name}</span>
                  {item.quantity > 1 && (
                    <span className="text-xs text-gray-400 ml-2">x{item.quantity}</span>
                  )}
                  {item.tags.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {item.tags.map((tag, idx) => (
                        <span key={idx} className="text-xs px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveItem(item.id)}
                  className="text-red-400 hover:text-red-300 text-sm"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Custom Item Form */}
        <div className="bg-gray-800 p-4 rounded border border-gray-700 space-y-3">
          <p className="text-sm font-medium text-gray-200">Add Custom Item:</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <input
                type="text"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="Item name"
                className="block w-full rounded-md bg-gray-900 border-gray-600 text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm placeholder:text-gray-500"
              />
            </div>
            <div>
              <input
                type="number"
                min="1"
                value={newItemQuantity}
                onChange={(e) => setNewItemQuantity(parseInt(e.target.value) || 1)}
                placeholder="Qty"
                className="block w-full rounded-md bg-gray-900 border-gray-600 text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm placeholder:text-gray-500"
              />
            </div>
          </div>
          <div>
            <input
              type="text"
              value={newItemTags}
              onChange={(e) => setNewItemTags(e.target.value)}
              placeholder="Tags (comma-separated, e.g., weapon, magical)"
              className="block w-full rounded-md bg-gray-900 border-gray-600 text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm placeholder:text-gray-500"
            />
          </div>
          <button
            type="button"
            onClick={handleAddItem}
            className="w-full px-3 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 text-sm font-medium"
          >
            Add Item
          </button>
        </div>

        <div className="mt-3">
          <label htmlFor="inventorySlots" className="block text-sm font-medium text-gray-200 mb-1">
            Inventory Slots
          </label>
          <input
            type="number"
            id="inventorySlots"
            min="5"
            max="20"
            value={formData.inventory.slots}
            onChange={(e) => setFormData({ ...formData, inventory: { ...formData.inventory, slots: parseInt(e.target.value) || 10 } })}
            className="mt-1 block w-32 rounded-md bg-gray-800 border-gray-700 text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">Maximum number of items you can carry</p>
        </div>
      </div>

      {/* Resources Section */}
      <div className="border-t border-gray-700 pt-6">
        <h3 className="text-lg font-medium text-gray-200 mb-4">Starting Resources</h3>
        <div>
          <label htmlFor="gold" className="block text-sm font-medium text-gray-200 mb-1">
            Gold / Currency
          </label>
          <input
            type="number"
            id="gold"
            min="0"
            value={formData.resources.gold}
            onChange={(e) => setFormData({ ...formData, resources: { ...formData.resources, gold: parseInt(e.target.value) || 0 } })}
            className="mt-1 block w-48 rounded-md bg-gray-800 border-gray-700 text-white shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">Starting wealth for your character</p>
        </div>
      </div>

      <div className="flex justify-end space-x-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
        >
          {isSubmitting ? 'Creating...' : 'Create Character'}
        </button>
      </div>
    </form>
  )
}

export default CreateCharacterForm
