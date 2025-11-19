// src/components/CreateCharacterForm.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

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
      strength: 10,
      dexterity: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
      constitution: 10,
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError('')

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/characters`, {
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 text-red-900 p-4 rounded-md">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">
          Character Name *
        </label>
        <input
          type="text"
          id="name"
          required
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          placeholder="Enter character name"
        />
      </div>

      <div>
        <label htmlFor="pronouns" className="block text-sm font-medium text-gray-700">
          Pronouns
        </label>
        <input
          type="text"
          id="pronouns"
          value={formData.pronouns}
          onChange={(e) => setFormData({ ...formData, pronouns: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          placeholder="e.g., they/them, she/her, he/him"
        />
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          id="description"
          rows={3}
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          placeholder="Physical appearance, personality traits, etc."
        />
      </div>

      <div>
        <label htmlFor="backstory" className="block text-sm font-medium text-gray-700">
          Backstory
        </label>
        <textarea
          id="backstory"
          rows={4}
          value={formData.backstory}
          onChange={(e) => setFormData({ ...formData, backstory: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          placeholder="Character history and background"
        />
      </div>

      <div>
        <label htmlFor="goals" className="block text-sm font-medium text-gray-700">
          Goals
        </label>
        <textarea
          id="goals"
          rows={2}
          value={formData.goals}
          onChange={(e) => setFormData({ ...formData, goals: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          placeholder="What does your character want to achieve?"
        />
      </div>

      <div>
        <label htmlFor="currentLocation" className="block text-sm font-medium text-gray-700">
          Starting Location
        </label>
        <input
          type="text"
          id="currentLocation"
          value={formData.currentLocation}
          onChange={(e) => setFormData({ ...formData, currentLocation: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          placeholder="Where does your character begin?"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Character Stats
        </label>
        <div className="grid grid-cols-2 gap-4">
          {Object.entries(formData.stats).map(([stat, value]) => (
            <div key={stat} className="flex items-center space-x-2">
              <label htmlFor={stat} className="text-sm capitalize w-24">
                {stat}:
              </label>
              <input
                type="number"
                id={stat}
                min="1"
                max="20"
                value={value}
                onChange={(e) => handleStatChange(stat, parseInt(e.target.value) || 0)}
                className="w-20 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end space-x-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {isSubmitting ? 'Creating...' : 'Create Character'}
        </button>
      </div>
    </form>
  )
}

export default CreateCharacterForm
