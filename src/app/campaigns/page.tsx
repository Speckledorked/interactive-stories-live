// src/app/campaigns/page.tsx
// Campaign list page — "Tavern" theme pilot (see reference mockup).
// Scoped to this one page only: new color tokens (ember/tavern/wine in
// tailwind.config.js), its own top bar + bottom nav (global Header is
// hidden on this exact route), decorative serif type. No background art —
// no image-generation tool available, so the "candlelit tavern" mood is a
// CSS gradient/vignette approximation, not the literal painted scene.

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, ChevronRight, Users, BookOpen, Compass, Scroll } from 'lucide-react'
import { authenticatedFetch, isAuthenticated, getLastCampaignId } from '@/lib/clientAuth'
import { displayFont } from '@/lib/tavernTheme'
import { bannerIconFor, formatRelativeTime } from '@/lib/tavernUtils'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { TavernButton, TavernCard, TavernErrorBanner, TavernEmptyState, TavernSpinner } from '@/components/tavern/ui'

interface Campaign {
  id: string
  title: string
  description: string
  universe: string
  userRole: 'ADMIN' | 'PLAYER'
  updatedAt: string
  createdAt: string
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
  const [lastCampaignId, setLastCampaignId] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    setLastCampaignId(getLastCampaignId())
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

      setCampaigns(campaigns.filter(c => c.id !== campaignId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete campaign')
    } finally {
      setDeletingCampaignId(null)
    }
  }

  return (
    <TavernPage>
      <TavernHeader wordmark />

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 pt-28 pb-28">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className={`${displayFont.className} text-2xl text-ember-100`}>Your Campaigns</h2>
            <div className="h-px w-24 bg-gradient-to-r from-ember-600 to-transparent mt-2" />
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-b from-wine-500 to-wine-700 hover:from-wine-400 hover:to-wine-600 text-ember-100 rounded-lg border border-ember-900/50 shadow-lg shadow-black/40 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">New Campaign</span>
          </button>
        </div>

        {error && <TavernErrorBanner>{error}</TavernErrorBanner>}

        {loading ? (
          <TavernSpinner />
        ) : campaigns.length === 0 ? (
          <TavernEmptyState
            icon={Scroll}
            title="No campaigns yet"
            description="Create your first campaign to begin your adventure"
            action={
              <TavernButton onClick={() => setShowCreateModal(true)}>Create Your First Campaign</TavernButton>
            }
          />
        ) : (
          <div className="space-y-4">
            {campaigns.map((campaign) => {
              const BannerIcon = bannerIconFor(campaign.id)
              return (
                <TavernCard
                  key={campaign.id}
                  onClick={() => router.push(`/campaigns/${campaign.id}`)}
                  className="group flex gap-4 p-4"
                >
                  {/* Banner icon */}
                  <div className="flex-shrink-0 w-16 h-20 rounded-sm bg-gradient-to-b from-tavern-700 to-tavern-900 border border-ember-800/40 flex items-center justify-center shadow-inner"
                       style={{ clipPath: 'polygon(0 0, 100% 0, 100% 85%, 50% 100%, 0 85%)' }}>
                    <BannerIcon className="w-7 h-7 text-ember-300/80" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className={`${displayFont.className} text-lg text-ember-100 leading-snug`}>
                        {campaign.title}
                      </h3>
                      <ChevronRight className="w-4 h-4 text-ember-600 flex-shrink-0 mt-1 group-hover:translate-x-0.5 transition-transform" />
                    </div>

                    <p className="text-sm text-ember-300/60 mt-1 line-clamp-2 leading-relaxed">
                      {campaign.description || 'No description yet.'}
                    </p>

                    <div className="flex items-center gap-4 mt-3 text-xs text-ember-400/60">
                      <span className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        {campaign._count.characters} Player{campaign._count.characters !== 1 ? 's' : ''}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5" />
                        {campaign._count.scenes} Session{campaign._count.scenes !== 1 ? 's' : ''}
                      </span>
                      <span>{formatRelativeTime(campaign.updatedAt)}</span>
                    </div>

                    {campaign.userRole === 'ADMIN' && (
                      <div className="flex gap-2 mt-3 pt-3 border-t border-ember-900/20">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            router.push(`/campaigns/${campaign.id}/admin?tab=settings`)
                          }}
                          className="px-3 py-1.5 text-xs rounded-md bg-tavern-700/60 hover:bg-tavern-600/60 text-ember-200 border border-ember-900/30 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteCampaign(campaign.id)
                          }}
                          disabled={deletingCampaignId === campaign.id}
                          className="px-3 py-1.5 text-xs rounded-md bg-wine-700/50 hover:bg-wine-600/60 text-ember-100 border border-wine-600/30 transition-colors disabled:opacity-50"
                        >
                          {deletingCampaignId === campaign.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    )}
                  </div>
                </TavernCard>
              )
            })}
          </div>
        )}

        {/* Decorative parchment quote banner */}
        <div className="mt-8 flex items-center gap-4 px-5 py-4 rounded-lg bg-ember-100/[0.06] border border-ember-800/30">
          <p className={`${displayFont.className} flex-1 text-sm text-ember-200/70 italic leading-relaxed`}>
            &ldquo;The greatest stories aren&rsquo;t written&hellip; They&rsquo;re lived.&rdquo;
          </p>
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-wine-500 to-wine-800 border border-ember-700/40 flex items-center justify-center">
            <Compass className="w-4 h-4 text-ember-300/70" />
          </div>
        </div>
      </main>

      <TavernNav active="tavern" campaignId={lastCampaignId || undefined} />

      {showCreateModal && (
        <CreateCampaignModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false)
            loadCampaigns()
          }}
        />
      )}
    </TavernPage>
  )
}

// Template definitions (mirrors campaign-templates.ts, kept here to avoid server imports in client component)
const TEMPLATES = [
  {
    id: 'pbta-fantasy',
    name: 'PbtA Fantasy',
    description: 'Dungeon World-style adventure with ruins, monsters, and rival factions.',
    universe: 'High Fantasy',
    tags: ['Fantasy', 'Dungeon Crawl', 'Magic'],
    moveCount: 6,
    factionCount: 3,
    emoji: '⚔️'
  },
  {
    id: 'mha-ua-arc',
    name: 'MHA: UA Arc',
    description: 'Superhero academy under attack. Quirks, villains, and heroic growth.',
    universe: 'Modern Superhero',
    tags: ['Superhero', 'School', 'Anime'],
    moveCount: 3,
    factionCount: 2,
    emoji: '🦸'
  },
  {
    id: 'monster-of-the-week',
    name: 'Monster of the Week',
    description: 'Hunters investigating supernatural threats in the modern world.',
    universe: 'Modern Horror',
    tags: ['Horror', 'Investigation', 'Supernatural'],
    moveCount: 3,
    factionCount: 1,
    emoji: '🔦'
  }
]

// Create Campaign Modal Component
function CreateCampaignModal({
  onClose,
  onSuccess
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null) // null = custom
  const [step, setStep] = useState<'template' | 'details'>('template')
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    universe: '',
    aiSystemPrompt: '',
    initialWorldSeed: ''
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleTemplateSelect = (templateId: string | null) => {
    setSelectedTemplate(templateId)
    if (templateId === null) {
      // Custom — clear pre-fills, show all fields
      setFormData(f => ({ ...f, universe: '', aiSystemPrompt: '', initialWorldSeed: '' }))
      setShowAdvanced(true)
    } else {
      // Template — pre-fill universe for display; server fills the rest
      const tpl = TEMPLATES.find(t => t.id === templateId)
      setFormData(f => ({ ...f, universe: tpl?.universe || '' }))
      setShowAdvanced(false)
    }
    setStep('details')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const payload: any = {
        title: formData.title,
        description: formData.description
      }

      if (selectedTemplate) {
        payload.templateId = selectedTemplate
        // Only pass overrides if user changed them in advanced
        if (showAdvanced && formData.universe) payload.universe = formData.universe
        if (showAdvanced && formData.aiSystemPrompt) payload.aiSystemPrompt = formData.aiSystemPrompt
        if (showAdvanced && formData.initialWorldSeed) payload.initialWorldSeed = formData.initialWorldSeed
      } else {
        // Custom — send everything
        payload.universe = formData.universe || 'Original'
        payload.aiSystemPrompt = formData.aiSystemPrompt || 'You are the Game Master for this campaign.'
        payload.initialWorldSeed = formData.initialWorldSeed || ''
      }

      const response = await authenticatedFetch('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify(payload)
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

  const selectedTpl = selectedTemplate ? TEMPLATES.find(t => t.id === selectedTemplate) : null

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-gradient-to-br from-tavern-800 to-tavern-950 border border-ember-800/40 shadow-2xl">
        <div className="p-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              {step === 'details' && (
                <button
                  onClick={() => setStep('template')}
                  className="text-ember-400/70 hover:text-ember-200 transition-colors p-1.5 hover:bg-white/5 rounded-lg"
                >
                  <ChevronRight className="w-5 h-5 rotate-180" />
                </button>
              )}
              <h2 className="text-2xl font-bold text-ember-100 tracking-tight">
                {step === 'template' ? 'Choose a Starting Point' : 'Campaign Details'}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-ember-400/70 hover:text-ember-200 transition-colors p-2 hover:bg-white/5 rounded-lg"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Step 1: Template selection */}
          {step === 'template' && (
            <div className="space-y-3">
              <p className="text-ember-300/50 text-sm mb-6">
                Templates pre-configure the AI Game Master, world factions, and moves so you can start playing immediately.
              </p>

              {TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => handleTemplateSelect(tpl.id)}
                  className="w-full text-left p-5 bg-black/20 hover:bg-black/30 border border-ember-900/30 hover:border-ember-600/50 rounded-2xl transition-all duration-200 group"
                >
                  <div className="flex items-start gap-4">
                    <span className="text-3xl">{tpl.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-ember-100 group-hover:text-ember-300 transition-colors">{tpl.name}</span>
                        <span className="text-xs text-ember-400/50 bg-black/30 px-2 py-0.5 rounded-full">{tpl.universe}</span>
                      </div>
                      <p className="text-sm text-ember-300/50 mb-3">{tpl.description}</p>
                      <div className="flex items-center gap-3 text-xs text-ember-400/40">
                        <span>{tpl.moveCount} moves</span>
                        <span>·</span>
                        <span>{tpl.factionCount} factions</span>
                        <span>·</span>
                        <div className="flex gap-1.5">
                          {tpl.tags.map(tag => (
                            <span key={tag} className="bg-black/40 px-2 py-0.5 rounded-full">{tag}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-ember-700 group-hover:text-ember-400 transition-colors flex-shrink-0 mt-1" />
                  </div>
                </button>
              ))}

              {/* Custom option */}
              <button
                onClick={() => handleTemplateSelect(null)}
                className="w-full text-left p-5 bg-black/10 hover:bg-black/20 border border-ember-900/20 hover:border-ember-800/40 rounded-2xl transition-all duration-200 group"
              >
                <div className="flex items-center gap-4">
                  <span className="text-3xl">✏️</span>
                  <div className="flex-1">
                    <p className="font-bold text-ember-300/70 group-hover:text-ember-100 transition-colors">Custom</p>
                    <p className="text-sm text-ember-400/40">Build your own world from scratch</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-ember-700 group-hover:text-ember-500 transition-colors flex-shrink-0" />
                </div>
              </button>
            </div>
          )}

          {/* Step 2: Campaign details form */}
          {step === 'details' && (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="bg-wine-800/30 border border-wine-600/40 text-ember-100 px-5 py-4 rounded-xl text-sm font-medium">
                  {error}
                </div>
              )}

              {/* Template badge */}
              {selectedTpl && (
                <div className="flex items-center gap-3 px-4 py-3 bg-ember-900/20 border border-ember-700/30 rounded-xl">
                  <span className="text-xl">{selectedTpl.emoji}</span>
                  <div>
                    <p className="text-sm font-semibold text-ember-200">{selectedTpl.name} template</p>
                    <p className="text-xs text-ember-400/50">
                      Includes {selectedTpl.moveCount} moves, {selectedTpl.factionCount} factions, AI system prompt, and world seed
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-ember-300/70 mb-2">
                  Campaign Title <span className="text-wine-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60"
                  placeholder={selectedTpl ? `e.g., ${selectedTpl.name} - My Campaign` : 'e.g., The Shattered Realm'}
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-ember-300/70 mb-2">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 min-h-[80px] resize-none"
                  placeholder="What's this campaign about?"
                />
              </div>

              {/* Custom fields — always shown for custom, toggleable for templates */}
              {selectedTemplate === null && (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-ember-300/70 mb-2">
                      Universe <span className="text-wine-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.universe}
                      onChange={(e) => setFormData({ ...formData, universe: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60"
                      placeholder="e.g., Original, Tolkien, Sci-Fi, Noir"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-ember-300/70 mb-2">
                      AI GM Instructions <span className="text-wine-400">*</span>
                    </label>
                    <textarea
                      value={formData.aiSystemPrompt}
                      onChange={(e) => setFormData({ ...formData, aiSystemPrompt: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 min-h-[120px] font-mono text-sm resize-none"
                      placeholder={`You are the Game Master for a [universe] campaign.\n\nCore Principles:\n- Fiction first\n- Be a fan of the characters\n...`}
                      required
                    />
                    <p className="text-xs text-ember-400/40 mt-1.5">Tells the AI how to run your world — tone, rules, GM moves</p>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-ember-300/70 mb-2">
                      World Seed
                    </label>
                    <textarea
                      value={formData.initialWorldSeed}
                      onChange={(e) => setFormData({ ...formData, initialWorldSeed: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 min-h-[80px] resize-none"
                      placeholder="The current state of the world — what's happening when the story begins?"
                    />
                  </div>
                </>
              )}

              {/* Advanced overrides for template campaigns */}
              {selectedTemplate !== null && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-2 text-sm text-ember-400/50 hover:text-ember-200 transition-colors"
                  >
                    <ChevronRight className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
                    Advanced — override template settings
                  </button>

                  {showAdvanced && (
                    <div className="mt-4 space-y-4 pl-4 border-l border-ember-900/30">
                      <div>
                        <label className="block text-sm font-semibold text-ember-300/70 mb-2">Universe</label>
                        <input
                          type="text"
                          value={formData.universe}
                          onChange={(e) => setFormData({ ...formData, universe: e.target.value })}
                          className="w-full px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60"
                          placeholder={selectedTpl?.universe}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-ember-300/70 mb-2">AI GM Instructions</label>
                        <textarea
                          value={formData.aiSystemPrompt}
                          onChange={(e) => setFormData({ ...formData, aiSystemPrompt: e.target.value })}
                          className="w-full px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 min-h-[100px] font-mono text-sm resize-none"
                          placeholder="Leave blank to use template instructions"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-ember-300/70 mb-2">World Seed</label>
                        <textarea
                          value={formData.initialWorldSeed}
                          onChange={(e) => setFormData({ ...formData, initialWorldSeed: e.target.value })}
                          className="w-full px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 min-h-[80px] resize-none"
                          placeholder="Leave blank to use template world seed"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-black/30 hover:bg-black/40 border border-ember-900/40 text-ember-300 font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-b from-wine-500 to-wine-700 hover:from-wine-400 hover:to-wine-600 border border-ember-900/50 text-ember-100 font-medium transition-all disabled:opacity-50"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="spinner h-5 w-5 border-white" />
                      {selectedTemplate ? 'Building your world…' : 'Creating…'}
                    </span>
                  ) : (
                    'Create Campaign'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
