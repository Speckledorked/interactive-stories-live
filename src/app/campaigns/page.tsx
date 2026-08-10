// src/app/campaigns/page.tsx
// Campaign list — every session's entry point. Migrated onto the myth
// design system (see docs/design-system.md): EmptyState for the
// zero-campaigns state, myth tokens throughout. Each campaign renders as a
// large chronicle card (CampaignChronicleCard) in a responsive grid — the
// whole card is the "enter this world" interaction, with Edit/Delete as
// quiet floating icon buttons rather than competing full-width buttons.
// The cinematic header reuses the freshest campaign's own hero art as its
// backdrop rather than any separate generated/stock asset.

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, ChevronRight, Scroll } from 'lucide-react'
import { authenticatedFetch, isAuthenticated, getLastCampaignId } from '@/lib/clientAuth'
import { fontDisplay } from '@/lib/fonts'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { TavernButton } from '@/components/tavern/ui'
import { EmptyState } from '@/components/ui/empty-state'
import { CampaignChronicleCard } from '@/components/campaigns/CampaignChronicleCard'

interface Campaign {
  id: string
  title: string
  description: string
  universe: string
  userRole: 'ADMIN' | 'PLAYER'
  updatedAt: string
  createdAt: string
  heroImageUrl: string | null
  heroImageStatus: string | null
  _count: {
    characters: number
    scenes: number
    memberships: number
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

  // Cinematic header backdrop: the most recently updated campaign that
  // actually has ready hero art, not a separate generated/stock image —
  // "your worlds" should feel like they're looking back at you.
  const backdropUrl = campaigns.reduce<{ url: string; updatedAt: string } | null>((freshest, c) => {
    if (c.heroImageStatus !== 'READY' || !c.heroImageUrl) return freshest
    if (!freshest || new Date(c.updatedAt) > new Date(freshest.updatedAt)) {
      return { url: c.heroImageUrl, updatedAt: c.updatedAt }
    }
    return freshest
  }, null)?.url ?? null

  return (
    <TavernPage background="myth">
      <TavernHeader wordmark variant="myth" />

      {/* Content */}
      <main className="max-w-2xl lg:max-w-6xl mx-auto px-4 pt-28 pb-28">
        {/* Cinematic header — the freshest world's own hero art bleeds in
            from the edge instead of the title floating in empty space. */}
        <div className="relative flex flex-col-reverse overflow-hidden rounded-lg border border-myth-border bg-myth-surface sm:flex-row">
          {backdropUrl && (
            <div className="relative h-40 sm:h-auto sm:w-2/5 lg:w-[45%]">
              {/* eslint-disable-next-line @next/next/no-img-element -- no next/image remote-host config exists yet; matches CampaignHero.tsx's convention. */}
              <img src={backdropUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-myth-surface sm:bg-gradient-to-r sm:from-myth-surface sm:via-myth-surface/20 sm:to-transparent" />
            </div>
          )}
          <div className="relative flex flex-1 flex-wrap items-start justify-between gap-4 px-6 py-8 sm:py-12">
            <div>
              <h1 className="font-display text-3xl font-semibold text-myth-ink sm:text-5xl">Your Campaigns</h1>
              <div className="mt-3 h-px w-16 bg-myth-gold/50" />
              <p className="mt-3 max-w-sm text-sm italic text-myth-ink-muted">
                Every world you&rsquo;ve stepped into, remembered exactly as you left it.
              </p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 rounded-lg bg-myth-accent px-4 py-2.5 text-sm font-medium text-myth-accent-ink transition-colors hover:bg-myth-accent-hover"
            >
              <Plus className="w-4 h-4" />
              <span>New Campaign</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-6 rounded-lg border border-myth-danger/30 bg-myth-danger/10 px-4 py-3 text-sm text-myth-danger">
            {error}
          </div>
        )}

        <div className="mt-8">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-myth-accent" />
            </div>
          ) : campaigns.length === 0 ? (
            <EmptyState
              icon={<Scroll className="h-6 w-6" />}
              title="No campaigns yet"
              description="Create your first campaign to begin your adventure"
              action={{ label: 'Create Your First Campaign', onClick: () => setShowCreateModal(true) }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {campaigns.map((campaign) => (
                <CampaignChronicleCard
                  key={campaign.id}
                  id={campaign.id}
                  title={campaign.title}
                  description={campaign.description}
                  userRole={campaign.userRole}
                  updatedAt={campaign.updatedAt}
                  heroImageUrl={campaign.heroImageUrl}
                  heroImageStatus={campaign.heroImageStatus}
                  playerCount={campaign._count.memberships}
                  sessionCount={campaign._count.scenes}
                  deleting={deletingCampaignId === campaign.id}
                  onEnter={() => router.push(`/campaigns/${campaign.id}`)}
                  onEdit={() => router.push(`/campaigns/${campaign.id}/admin?tab=settings`)}
                  onDelete={() => handleDeleteCampaign(campaign.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* A line from the codex, styled like a manuscript pull-quote
            rather than an incidental card. */}
        <div className="mt-10 border-l-2 border-myth-gold/50 pl-5">
          <p className="font-mono text-xs uppercase tracking-wider text-myth-gold">From the MythOS Codex</p>
          <p className="mt-2 font-display text-lg italic leading-relaxed text-myth-ink-muted sm:text-xl">
            &ldquo;The greatest stories aren&rsquo;t written&hellip; They&rsquo;re lived.&rdquo;
          </p>
        </div>
      </main>

      <TavernNav active="tavern" campaignId={lastCampaignId || undefined} variant="myth" />

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
    name: 'Fantasy Adventure',
    description: 'Adventure with ruins, monsters, and rival factions.',
    universe: 'High Fantasy',
    tags: ['Fantasy', 'Dungeon Crawl', 'Magic'],
    factionCount: 3,
    emoji: '⚔️'
  },
  {
    id: 'mha-ua-arc',
    name: 'MHA: UA Arc',
    description: 'Superhero academy under attack. Quirks, villains, and heroic growth.',
    universe: 'Modern Superhero',
    tags: ['Superhero', 'School', 'Anime'],
    factionCount: 2,
    emoji: '🦸'
  },
  {
    id: 'monster-of-the-week',
    name: 'Monster of the Week',
    description: 'Hunters investigating supernatural threats in the modern world.',
    universe: 'Modern Horror',
    tags: ['Horror', 'Investigation', 'Supernatural'],
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
  const [loreUrl, setLoreUrl] = useState('')
  const [loreCrawlWiki, setLoreCrawlWiki] = useState(true)
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

      if (loreUrl.trim()) {
        payload.loreImport = {
          sourceType: loreCrawlWiki ? 'WIKI' : 'URL',
          sourceUrl: loreUrl.trim(),
        }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-myth-border bg-myth-surface-raised shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.16)]">
        <div className="p-8">
          {/* Header */}
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {step === 'details' && (
                <button
                  onClick={() => setStep('template')}
                  className="rounded-lg p-1.5 text-myth-ink-faint transition-colors hover:bg-myth-surface-sunken hover:text-myth-ink"
                >
                  <ChevronRight className="h-5 w-5 rotate-180" />
                </button>
              )}
              <h2 className={`${fontDisplay.className} text-2xl font-semibold text-myth-ink`}>
                {step === 'template' ? 'Choose a Starting Point' : 'Campaign Details'}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-myth-ink-faint transition-colors hover:bg-myth-surface-sunken hover:text-myth-ink"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Step 1: Template selection */}
          {step === 'template' && (
            <div className="space-y-3">
              <p className="mb-6 text-sm text-myth-ink-muted">
                Templates pre-configure MythOS, world factions, and starting content so you can start playing immediately.
              </p>

              {TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => handleTemplateSelect(tpl.id)}
                  className="group w-full rounded-lg border border-myth-border p-5 text-left transition-all hover:border-myth-border-strong hover:bg-myth-surface-sunken"
                >
                  <div className="flex items-start gap-4">
                    <span className="text-3xl">{tpl.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-myth-ink">{tpl.name}</span>
                        <span className="rounded-full bg-myth-surface-sunken px-2 py-0.5 text-xs text-myth-ink-faint">{tpl.universe}</span>
                      </div>
                      <p className="mb-3 text-sm text-myth-ink-muted">{tpl.description}</p>
                      <div className="flex items-center gap-3 text-xs text-myth-ink-faint">
                        <span>{tpl.factionCount} factions</span>
                        <span>·</span>
                        <div className="flex gap-1.5">
                          {tpl.tags.map(tag => (
                            <span key={tag} className="rounded-full bg-myth-surface-sunken px-2 py-0.5">{tag}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="mt-1 h-5 w-5 flex-shrink-0 text-myth-ink-faint transition-colors group-hover:text-myth-ink-muted" />
                  </div>
                </button>
              ))}

              {/* Custom option */}
              <button
                onClick={() => handleTemplateSelect(null)}
                className="group w-full rounded-lg border border-dashed border-myth-border p-5 text-left transition-all hover:border-myth-border-strong hover:bg-myth-surface-sunken"
              >
                <div className="flex items-center gap-4">
                  <span className="text-3xl">✏️</span>
                  <div className="flex-1">
                    <p className="font-semibold text-myth-ink-muted group-hover:text-myth-ink">Custom</p>
                    <p className="text-sm text-myth-ink-faint">Build your own world from scratch</p>
                  </div>
                  <ChevronRight className="h-5 w-5 flex-shrink-0 text-myth-ink-faint transition-colors group-hover:text-myth-ink-muted" />
                </div>
              </button>
            </div>
          )}

          {/* Step 2: Campaign details form */}
          {step === 'details' && (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="rounded-lg border border-myth-danger/30 bg-myth-danger/10 px-5 py-4 text-sm font-medium text-myth-danger">
                  {error}
                </div>
              )}

              {/* Template badge */}
              {selectedTpl && (
                <div className="flex items-center gap-3 rounded-lg border border-myth-border bg-myth-surface-sunken px-4 py-3">
                  <span className="text-xl">{selectedTpl.emoji}</span>
                  <div>
                    <p className="text-sm font-semibold text-myth-ink">{selectedTpl.name} template</p>
                    <p className="text-xs text-myth-ink-faint">
                      Includes {selectedTpl.factionCount} factions, AI system prompt, and world seed
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm font-semibold text-myth-ink-muted">
                  Campaign Title <span className="text-myth-danger">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full rounded-md border border-myth-border bg-myth-surface px-4 py-2.5 text-myth-ink placeholder:text-myth-ink-faint focus:border-myth-accent focus:outline-none"
                  placeholder={selectedTpl ? `e.g., ${selectedTpl.name} - My Campaign` : 'e.g., The Shattered Realm'}
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-myth-ink-muted">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="min-h-[80px] w-full resize-none rounded-md border border-myth-border bg-myth-surface px-4 py-2.5 text-myth-ink placeholder:text-myth-ink-faint focus:border-myth-accent focus:outline-none"
                  placeholder="What's this campaign about?"
                />
              </div>

              {/* Canon lore — imported in the background after creation;
                  when it finishes, the world's factions/systems are rebuilt
                  from canon automatically (see reseedWorld.ts). */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-myth-ink-muted">
                  Canon Lore <span className="font-normal text-myth-ink-faint">(optional)</span>
                </label>
                <input
                  type="url"
                  value={loreUrl}
                  onChange={(e) => setLoreUrl(e.target.value)}
                  className="w-full rounded-md border border-myth-border bg-myth-surface px-4 py-2.5 text-myth-ink placeholder:text-myth-ink-faint focus:border-myth-accent focus:outline-none"
                  placeholder="e.g., https://coppermind.net — a wiki or article about your universe"
                />
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-myth-ink-muted">
                  <input
                    type="checkbox"
                    checked={loreCrawlWiki}
                    onChange={(e) => setLoreCrawlWiki(e.target.checked)}
                    className="rounded border-myth-border"
                  />
                  Crawl the whole wiki (works for MediaWiki sites: Fandom, wiki.gg, Wikipedia...)
                </label>
                <p className="mt-1.5 text-xs text-myth-ink-faint">
                  Imports in the background — your world&apos;s factions, powers, and character archetypes are
                  rebuilt from this canon automatically. The campaign stays locked (no characters or scenes)
                  until the world is ready, usually a few minutes for a whole wiki. You can also paste text or
                  add more sources later in Admin → Lore.
                </p>
              </div>

              {/* Custom fields — always shown for custom, toggleable for templates */}
              {selectedTemplate === null && (
                <>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-myth-ink-muted">
                      Universe <span className="text-myth-danger">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.universe}
                      onChange={(e) => setFormData({ ...formData, universe: e.target.value })}
                      className="w-full rounded-md border border-myth-border bg-myth-surface px-4 py-2.5 text-myth-ink placeholder:text-myth-ink-faint focus:border-myth-accent focus:outline-none"
                      placeholder="e.g., Original, Tolkien, Sci-Fi, Noir"
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-myth-ink-muted">
                      MythOS Instructions <span className="text-myth-danger">*</span>
                    </label>
                    <textarea
                      value={formData.aiSystemPrompt}
                      onChange={(e) => setFormData({ ...formData, aiSystemPrompt: e.target.value })}
                      className="min-h-[120px] w-full resize-none rounded-md border border-myth-border bg-myth-surface px-4 py-2.5 font-mono text-sm text-myth-ink placeholder:text-myth-ink-faint focus:border-myth-accent focus:outline-none"
                      placeholder={`You are the Game Master for a [universe] campaign.\n\nCore Principles:\n- Fiction first\n- Be a fan of the characters\n...`}
                      required
                    />
                    <p className="mt-1.5 text-xs text-myth-ink-faint">Tells MythOS how to run your world — tone, rules, narrative techniques</p>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-myth-ink-muted">
                      World Seed
                    </label>
                    <textarea
                      value={formData.initialWorldSeed}
                      onChange={(e) => setFormData({ ...formData, initialWorldSeed: e.target.value })}
                      className="min-h-[80px] w-full resize-none rounded-md border border-myth-border bg-myth-surface px-4 py-2.5 text-myth-ink placeholder:text-myth-ink-faint focus:border-myth-accent focus:outline-none"
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
                    className="flex items-center gap-2 text-sm text-myth-ink-faint transition-colors hover:text-myth-ink"
                  >
                    <ChevronRight className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
                    Advanced — override template settings
                  </button>

                  {showAdvanced && (
                    <div className="mt-4 space-y-4 border-l border-myth-border pl-4">
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-myth-ink-muted">Universe</label>
                        <input
                          type="text"
                          value={formData.universe}
                          onChange={(e) => setFormData({ ...formData, universe: e.target.value })}
                          className="w-full rounded-md border border-myth-border bg-myth-surface px-4 py-2.5 text-myth-ink placeholder:text-myth-ink-faint focus:border-myth-accent focus:outline-none"
                          placeholder={selectedTpl?.universe}
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-myth-ink-muted">MythOS Instructions</label>
                        <textarea
                          value={formData.aiSystemPrompt}
                          onChange={(e) => setFormData({ ...formData, aiSystemPrompt: e.target.value })}
                          className="min-h-[100px] w-full resize-none rounded-md border border-myth-border bg-myth-surface px-4 py-2.5 font-mono text-sm text-myth-ink placeholder:text-myth-ink-faint focus:border-myth-accent focus:outline-none"
                          placeholder="Leave blank to use template instructions"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-myth-ink-muted">World Seed</label>
                        <textarea
                          value={formData.initialWorldSeed}
                          onChange={(e) => setFormData({ ...formData, initialWorldSeed: e.target.value })}
                          className="min-h-[80px] w-full resize-none rounded-md border border-myth-border bg-myth-surface px-4 py-2.5 text-myth-ink placeholder:text-myth-ink-faint focus:border-myth-accent focus:outline-none"
                          placeholder="Leave blank to use template world seed"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <TavernButton type="button" onClick={onClose} variant="secondary" theme="myth" className="flex-1 text-center">
                  Cancel
                </TavernButton>
                <TavernButton type="submit" disabled={loading} theme="myth" className="flex-1 text-center">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-myth-accent-ink" />
                      {selectedTemplate ? 'Building your world…' : 'Creating…'}
                    </span>
                  ) : (
                    'Create Campaign'
                  )}
                </TavernButton>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
