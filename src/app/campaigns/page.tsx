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
        <div className="relative">
          <div className="spinner h-16 w-16"></div>
          <div className="absolute inset-0 h-16 w-16 rounded-full bg-primary-500/20 animate-ping"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto animate-fade-in">
      {/* Hero Header */}
      <div className="relative mb-12">
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-primary-500/10 via-accent-500/5 to-transparent blur-3xl"></div>
        <div className="flex items-end justify-between">
          <div className="space-y-2">
            <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent">
              Your Campaigns
            </h1>
            <p className="text-lg text-gray-400">Embark on AI-powered adventures</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2 shadow-glow"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>Create Campaign</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-gradient-to-r from-danger-500/10 to-danger-600/5 border border-danger-500/30 text-danger-400 px-6 py-4 rounded-2xl mb-8 backdrop-blur-sm shadow-lg animate-slide-up">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="font-medium">{error}</span>
          </div>
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="card text-center py-16 max-w-2xl mx-auto animate-scale-in">
          <div className="relative inline-block mb-6">
            <div className="text-7xl animate-bounce">🎲</div>
            <div className="absolute inset-0 bg-primary-500/20 blur-3xl"></div>
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">No campaigns yet</h2>
          <p className="text-gray-400 mb-8 text-lg">Create your first campaign to begin your adventure</p>
          <button onClick={() => setShowCreateModal(true)} className="btn-primary shadow-glow">
            <span className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Your First Campaign
            </span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-8">
          {campaigns.map((campaign, index) => (
            <div
              key={campaign.id}
              className="card group relative overflow-hidden cursor-pointer glow-on-hover"
              style={{ animationDelay: `${index * 50}ms` }}
              onClick={() => router.push(`/campaigns/${campaign.id}`)}
            >
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

              <div className="relative">
                <div className="flex items-start justify-between mb-4">
                  <h3 className="text-xl font-bold text-white group-hover:text-primary-400 transition-colors line-clamp-1">
                    {campaign.title}
                  </h3>
                  <span className={`badge flex-shrink-0 ml-2 ${
                    campaign.userRole === 'ADMIN'
                      ? 'badge-primary'
                      : 'bg-dark-700/50 border-dark-600 text-gray-400'
                  }`}>
                    {campaign.userRole}
                  </span>
                </div>

                <p className="text-sm text-gray-400 mb-6 line-clamp-2 leading-relaxed">
                  {campaign.description}
                </p>

                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="px-3 py-1.5 bg-dark-800/50 rounded-lg border border-dark-700/50 text-gray-400 font-medium">
                      {campaign.universe}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    <div className="flex items-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      <span className="font-medium">{campaign._count.characters}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="font-medium">{campaign._count.scenes}</span>
                    </div>
                  </div>
                </div>

                {campaign.userRole === 'ADMIN' && (
                  <div className="divider my-4"></div>
                )}

                {campaign.userRole === 'ADMIN' && (
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        router.push(`/campaigns/${campaign.id}/admin?tab=settings`)
                      }}
                      className="flex-1 px-4 py-2.5 bg-dark-800 hover:bg-dark-700 text-white rounded-xl border border-dark-700 hover:border-dark-600 font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteCampaign(campaign.id)
                      }}
                      disabled={deletingCampaignId === campaign.id}
                      className="flex-1 px-4 py-2.5 bg-gradient-to-r from-danger-600 to-danger-500 hover:from-danger-500 hover:to-danger-400 text-white rounded-xl font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-danger-500/20"
                    >
                      {deletingCampaignId === campaign.id ? (
                        <span className="flex items-center justify-center gap-2">
                          <div className="spinner h-4 w-4 border-white"></div>
                          Deleting...
                        </span>
                      ) : (
                        'Delete'
                      )}
                    </button>
                  </div>
                )}
              </div>
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
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-bold text-white tracking-tight">Create Campaign</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-lg"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-gradient-to-r from-danger-500/10 to-danger-600/5 border border-danger-500/30 text-danger-400 px-6 py-4 rounded-2xl backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="font-medium">{error}</span>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2.5">
                Campaign Title <span className="text-danger-400">*</span>
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
              <label className="block text-sm font-semibold text-gray-300 mb-2.5">
                Description <span className="text-danger-400">*</span>
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="input-field min-h-[100px] resize-none"
                placeholder="Brief description of your campaign..."
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2.5">
                Universe <span className="text-danger-400">*</span>
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
              <label className="block text-sm font-semibold text-gray-300 mb-2.5">
                AI GM System Prompt <span className="text-danger-400">*</span>
              </label>
              <textarea
                value={formData.aiSystemPrompt}
                onChange={(e) => setFormData({ ...formData, aiSystemPrompt: e.target.value })}
                className="input-field min-h-[140px] font-mono text-sm resize-none"
                required
              />
              <p className="text-xs text-gray-500 mt-2 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Instructions for how the AI should run your game
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2.5">
                Initial World Seed <span className="text-danger-400">*</span>
              </label>
              <textarea
                value={formData.initialWorldSeed}
                onChange={(e) => setFormData({ ...formData, initialWorldSeed: e.target.value })}
                className="input-field min-h-[100px] resize-none"
                placeholder="Starting situation of your campaign..."
                required
              />
            </div>

            <div className="flex gap-3 pt-4">
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
                className="flex-1 btn-primary"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="spinner h-5 w-5 border-white"></div>
                    Creating...
                  </span>
                ) : (
                  'Create Campaign'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
