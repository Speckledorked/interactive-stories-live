// src/components/CreateCharacterFormPbtA.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PBTA_STATS } from '@/lib/pbta-moves'

interface CreateCharacterFormPbtAProps {
  campaignId: string
  onSuccess?: () => void
  onCancel?: () => void
}

export function CreateCharacterFormPbtA({ 
  campaignId, 
  onSuccess, 
  onCancel 
}: CreateCharacterFormPbtAProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [statsTotal, setStatsTotal] = useState(0)

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
    harm: 0,
    experience: 0,
    conditions: [] as string[],
    moves: [] as string[],
  })

  // PbtA stat arrays based on playbook archetypes
  const statArrays = [
    { name: "Balanced", stats: { cool: 1, hard: 0, hot: 0, sharp: 1, weird: -1 } },
    { name: "Fighter", stats: { cool: -1, hard: 2, hot: 0, sharp: 1, weird: -1 } },
    { name: "Face", stats: { cool: 1, hard: -1, hot: 2, sharp: 0, weird: -1 } },
    { name: "Brain", stats: { cool: -1, hard: -1, hot: 0, sharp: 2, weird: 1 } },
    { name: "Mystic", stats: { cool: 0, hard: -1, hot: -1, sharp: 1, weird: 2 } },
    { name: "Survivor", stats: { cool: 2, hard: 1, hot: -1, sharp: 0, weird: -1 } },
    { name: "Custom", stats: { cool: 0, hard: 0, hot: 0, sharp: 0, weird: 0 } },
  ]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError('')

    // Validate stats total for custom
    if (statsTotal > 3) {
      setError('Custom stats total cannot exceed +3')
      setIsSubmitting(false)
      return
    }

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

  const handleStatArraySelect = (stats: Record<string, number>) => {
    setFormData(prev => ({ ...prev, stats }))
    const total = Object.values(stats).reduce((sum, val) => sum + val, 0)
    setStatsTotal(total)
  }

  const handleStatChange = (stat: string, value: number) => {
    // Clamp between -2 and +3
    value = Math.max(-2, Math.min(3, value))
    
    const newStats = { ...formData.stats, [stat]: value }
    const total = Object.values(newStats).reduce((sum, val) => sum + val, 0)
    
    if (total <= 3) {
      setFormData(prev => ({ ...prev, stats: newStats }))
      setStatsTotal(total)
    }
  }

  const availableConditions = [
    "Shaken", "Scared", "Hopeless", "Angry", 
    "Wounded", "Unstable", "Dazed", "Confused"
  ]

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 text-red-900 p-4 rounded-md">
          {error}
        </div>
      )}

      {/* Basic Info */}
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
          Look & Style
        </label>
        <textarea
          id="description"
          rows={2}
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          placeholder="What do they look like? How do they dress? What's their vibe?"
        />
      </div>

      {/* Stats Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Stats (PbtA System)
        </label>
        
        {/* Quick Select Arrays */}
        <div className="mb-4">
          <p className="text-xs text-gray-600 mb-2">Quick select a stat array:</p>
          <div className="grid grid-cols-3 gap-2">
            {statArrays.map((array) => (
              <button
                key={array.name}
                type="button"
                onClick={() => handleStatArraySelect(array.stats)}
                className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md"
              >
                {array.name}
              </button>
            ))}
          </div>
        </div>

        {/* Individual Stats */}
        <div className="space-y-3 p-4 bg-gray-50 rounded-md">
          {Object.entries(PBTA_STATS).map(([stat, description]) => (
            <div key={stat} className="flex items-center justify-between">
              <div className="flex-1">
                <label className="text-sm font-medium capitalize">{stat}</label>
                <p className="text-xs text-gray-500">{description}</p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => handleStatChange(stat, formData.stats[stat as keyof typeof formData.stats] - 1)}
                  className="px-2 py-1 bg-gray-200 rounded hover:bg-gray-300"
                >
                  -
                </button>
                <span className="w-12 text-center font-medium">
                  {formData.stats[stat as keyof typeof formData.stats] >= 0 ? '+' : ''}
                  {formData.stats[stat as keyof typeof formData.stats]}
                </span>
                <button
                  type="button"
                  onClick={() => handleStatChange(stat, formData.stats[stat as keyof typeof formData.stats] + 1)}
                  className="px-2 py-1 bg-gray-200 rounded hover:bg-gray-300"
                >
                  +
                </button>
              </div>
            </div>
          ))}
          
          <div className="text-sm text-gray-600 border-t pt-2">
            Total: {statsTotal >= 0 ? '+' : ''}{statsTotal} (Max: +3)
          </div>
        </div>
      </div>

      {/* Backstory & Goals */}
      <div>
        <label htmlFor="backstory" className="block text-sm font-medium text-gray-700">
          History
        </label>
        <textarea
          id="backstory"
          rows={3}
          value={formData.backstory}
          onChange={(e) => setFormData({ ...formData, backstory: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          placeholder="Where did they come from? What shaped them?"
        />
      </div>

      <div>
        <label htmlFor="goals" className="block text-sm font-medium text-gray-700">
          What Do They Want?
        </label>
        <textarea
          id="goals"
          rows={2}
          value={formData.goals}
          onChange={(e) => setFormData({ ...formData, goals: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          placeholder="What drives them? What are they after?"
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
          placeholder="Where do they begin?"
        />
      </div>

      {/* Starting Conditions (Optional) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Starting Conditions (Optional)
        </label>
        <div className="flex flex-wrap gap-2">
          {availableConditions.map((condition) => (
            <button
              key={condition}
              type="button"
              onClick={() => {
                const isSelected = formData.conditions.includes(condition)
                setFormData(prev => ({
                  ...prev,
                  conditions: isSelected
                    ? prev.conditions.filter(c => c !== condition)
                    : [...prev.conditions, condition]
                }))
              }}
              className={`px-3 py-1 rounded-md text-sm ${
                formData.conditions.includes(condition)
                  ? 'bg-red-100 text-red-700 border-red-300'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              } border`}
            >
              {condition}
            </button>
          ))}
        </div>
      </div>

      {/* Form Actions */}
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