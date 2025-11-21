// src/components/CreateCharacterForm.tsx
// Updated for Phase 7 with PbtA stats
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PBTA_STATS } from '@/lib/pbta-moves'

interface CreateCharacterFormProps {
  campaignId: string
  onSuccess?: () => void
  onCancel?: () => void
}

export function CreateCharacterForm({ 
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
  })

  // Track stat points allocation
  const [remainingPoints, setRemainingPoints] = useState(3) // Start with 3 points to distribute
  const MAX_STAT = 2
  const MIN_STAT = -1

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
    const currentValue = formData.stats[stat as keyof typeof formData.stats]
    const diff = value - currentValue

    // Check if we have enough points
    if (diff > 0 && remainingPoints < diff) {
      return // Not enough points
    }

    // Apply limits
    if (value < MIN_STAT || value > MAX_STAT) {
      return
    }

    setFormData(prev => ({
      ...prev,
      stats: {
        ...prev.stats,
        [stat]: value,
      },
    }))

    setRemainingPoints(prev => prev - diff)
  }

  const getStatDescription = (stat: string): string => {
    return PBTA_STATS[stat as keyof typeof PBTA_STATS] || ''
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 text-red-900 p-4 rounded-md">
          {error}
        </div>
      )}

      {/* Basic Info */}
      <div className="space-y-4">
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
      </div>

      {/* PbtA Stats */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">
            Character Stats
          </label>
          <span className={`text-sm ${remainingPoints === 0 ? 'text-green-600' : 'text-indigo-600'}`}>
            {remainingPoints === 0 ? '✓ Ready!' : `${remainingPoints} points remaining`}
          </span>
        </div>
        
        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-xs text-gray-600 mb-3">
            Distribute 3 points among your stats. Range: -1 to +2
          </p>
          
          <div className="space-y-3">
            {Object.entries(formData.stats).map(([stat, value]) => (
              <div key={stat} className="flex items-center space-x-3">
                <div className="w-20">
                  <span className="text-sm font-medium capitalize">{stat}</span>
                </div>
                
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => handleStatChange(stat, value - 1)}
                    disabled={value <= MIN_STAT}
                    className="w-8 h-8 rounded-full bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    -
                  </button>
                  
                  <div className="w-12 text-center">
                    <span className="text-lg font-bold">
                      {value >= 0 ? '+' : ''}{value}
                    </span>
                  </div>
                  
                  <button
                    type="button"
                    onClick={() => handleStatChange(stat, value + 1)}
                    disabled={value >= MAX_STAT || remainingPoints === 0}
                    className="w-8 h-8 rounded-full bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    +
                  </button>
                </div>
                
                <div className="flex-1 text-xs text-gray-500">
                  {getStatDescription(stat).split(' - ')[1]}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Background */}
      <div className="space-y-4">
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
            placeholder="What's your character's history? What drives them?"
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
          disabled={isSubmitting || remainingPoints > 0}
          className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {isSubmitting ? 'Creating...' : remainingPoints > 0 ? `Allocate ${remainingPoints} more points` : 'Create Character'}
        </button>
      </div>
    </form>
  )
}