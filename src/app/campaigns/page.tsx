// src/app/campaigns/page.tsx
// Campaign list page

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'

interface Campaign {
  id: string
  title: string
  description: string
  universe: string
  userRole: 'ADMIN' | 'PLAYER'
  _count: {
    characters: number
    scenes: number
  }
}

export default function CampaignsPage() {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [deletingCampaignId, setDeletingCampaignId] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    loadCampaigns()
  }, [router])

  const loadCampaigns = async () => {
    try {
      const response = await authenticatedFetch('/api/campaigns')
      if (!response.ok) throw new Error('Failed to load campaigns')

      const data = await response.json()
      setCampaigns(data.campaigns)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaigns')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteCampaign = async (campaignId: string) => {
    if (!confirm('Are you sure you want to delete this campaign? This action cannot be undone.')) {
      return
    }

    setDeletingCampaignId(campaignId)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}`, {
        method: 'DELETE'
      })

      if (!response.ok) throw new Error('Failed to delete campaign')

      // Remove from list
      setCampaigns(campaigns.filter(c => c.id !== campaignId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete campaign')
    } finally {
      setDeletingCampaignId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Your Campaigns</h1>
          <p className="text-gray-400 mt-2">Manage your AI-powered adventures</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary"
        >
          + Create Campaign
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-6xl mb-4">🎲</div>
          <h2 className="text-xl font-bold text-white mb-2">No campaigns yet</h2>
          <p className="text-gray-400 mb-6">Create your first campaign to get started</p>
          <button onClick={() => setShowCreateModal(true)} className="btn-primary">
            Create Campaign
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {campaigns.map((campaign) => (
            <div
              key={campaign.id}
              className="card relative"
            >
              <div
                onClick={() => router.push(`/campaigns/${campaign.id}`)}
                className="cursor-pointer"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-bold text-white">{campaign.title}</h3>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    campaign.userRole === 'ADMIN'
                      ? 'bg-primary-500/20 text-primary-400'
                      : 'bg-gray-700 text-gray-300'
                  }`}>
                    {campaign.userRole}
                  </span>
                </div>

                <p className="text-sm text-gray-400 mb-4 line-clamp-2">
                  {campaign.description}
                </p>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Universe: {campaign.universe}</span>
                  <div className="flex items-center space-x-3 text-gray-500">
                    <span>👥 {campaign._count.characters}</span>
                    <span>📜 {campaign._count.scenes}</span>
                  </div>
                </div>
              </div>

              {campaign.userRole === 'ADMIN' && (
                <div className="mt-4 pt-4 border-t border-gray-700 flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      router.push(`/campaigns/${campaign.id}/admin?tab=settings`)
                    }}
                    className="flex-1 px-3 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-600 transition-colors text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteCampaign(campaign.id)
                    }}
                    disabled={deletingCampaignId === campaign.id}
                    className="flex-1 px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors disabled:opacity-50 text-sm"
                  >
                    {deletingCampaignId === campaign.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateCampaignModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false)
            loadCampaigns()
          }}
        />
      )}
    </div>
  )
}

// Create Campaign Modal Component
function CreateCampaignModal({
  onClose,
  onSuccess
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    universe: 'Original',
    aiSystemPrompt: `You are the SOLE Game Master for this campaign. There is NO human GM.
You control ALL NPCs, villains, factions, and background events.
Players control ONLY their own characters and their actions.
Make the story engaging, dramatic, and responsive to player choices.`,
    initialWorldSeed: 'The adventure begins in a time of change and uncertainty...'
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await authenticatedFetch('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify(formData)
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create campaign')
      }

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">Create Campaign</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Campaign Title *
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="input-field"
                placeholder="e.g., Whisper - MHA Timeline"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Description *
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="input-field min-h-[80px]"
                placeholder="Brief description of your campaign..."
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Universe *
              </label>
              <input
                type="text"
                value={formData.universe}
                onChange={(e) => setFormData({ ...formData, universe: e.target.value })}
                className="input-field"
                placeholder="e.g., MHA, Cosmere, D&D, Original"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                AI GM System Prompt *
              </label>
              <textarea
                value={formData.aiSystemPrompt}
                onChange={(e) => setFormData({ ...formData, aiSystemPrompt: e.target.value })}
                className="input-field min-h-[120px] font-mono text-sm"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Instructions for how the AI should run your game
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Initial World Seed *
              </label>
              <textarea
                value={formData.initialWorldSeed}
                onChange={(e) => setFormData({ ...formData, initialWorldSeed: e.target.value })}
                className="input-field min-h-[80px]"
                placeholder="Starting situation of your campaign..."
                required
              />
            </div>

            <div className="flex space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 btn-primary disabled:opacity-50"
              >
                {loading ? 'Creating...' : 'Create Campaign'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
