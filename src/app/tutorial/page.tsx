'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authenticatedFetch, isAuthenticated, getUser, getLastCampaignId } from '@/lib/clientAuth'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import type { TutorialStepWithProgress, TutorialProgressResponse } from '@/types/api'
import { Button } from '@/components/ui/button'

type TutorialStep = TutorialStepWithProgress

export default function TutorialPage() {
  const router = useRouter()
  const [steps, setSteps] = useState<TutorialStep[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [completionPercentage, setCompletionPercentage] = useState(0)
  const [lastCampaignId, setLastCampaignId] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    setLastCampaignId(getLastCampaignId())
    loadTutorialProgress()
  }, [])

  const loadTutorialProgress = async () => {
    try {
      const response = await authenticatedFetch('/api/tutorial/progress')
      if (response.ok) {
        // #308: the route returns `progress`, not `steps` — this used to
        // read a key that never existed, so `steps` stayed permanently
        // empty and every category section (which renders null when its
        // step list is empty) never showed up at all.
        const data: TutorialProgressResponse = await response.json()
        setSteps(data.progress || [])
        setCompletionPercentage(data.completionPercentage || 0)
      } else {
        setError('Failed to load tutorial progress')
      }
    } catch (err) {
      setError('Failed to load tutorial progress')
    } finally {
      setLoading(false)
    }
  }

  const handleSkipStep = async (stepId: string) => {
    try {
      const response = await authenticatedFetch(`/api/tutorial/steps/${stepId}/skip`, {
        method: 'POST'
      })
      if (response.ok) {
        loadTutorialProgress()
      }
    } catch (err) {
      console.error('Failed to skip step:', err)
    }
  }

  if (loading) {
    return (
      <TavernPage background="myth">
        <TavernHeader backHref="/campaigns" title="Tutorial & Onboarding" variant="myth" />
        <main className="max-w-4xl mx-auto px-4 pt-28 pb-16">
          <div className="flex justify-center py-16">
            <div className="h-16 w-16 animate-spin rounded-full border-b-2 border-myth-accent" />
          </div>
        </main>
      </TavernPage>
    )
  }

  const groupedSteps = steps.reduce((acc, step) => {
    if (!acc[step.category]) acc[step.category] = []
    acc[step.category].push(step)
    return acc
  }, {} as Record<string, TutorialStep[]>)

  const categoryOrder = ['basics', 'social', 'combat', 'advanced']
  const categoryLabels = {
    basics: 'Basics',
    social: 'Social & Communication',
    combat: 'Combat',
    advanced: 'Advanced'
  }

  const categoryIcons = {
    basics: '🎮',
    social: '💬',
    combat: '⚔️',
    advanced: '🚀'
  }

  return (
    <TavernPage background="myth">
      <TavernHeader backHref="/campaigns" title="Tutorial & Onboarding" variant="myth" />

      <main className="max-w-4xl mx-auto px-4 pt-28 pb-28">
        <p className="mb-8 text-sm text-myth-ink-faint">Master the art of AI-powered tabletop adventures</p>

      {/* Progress Card */}
      <div className="mb-8 rounded-lg border border-myth-border bg-myth-surface p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-myth-ink">Your Progress</h2>
          <div className="rounded-full border border-myth-border bg-myth-surface-sunken px-4 py-2 text-lg font-medium text-myth-ink">
            {completionPercentage}%
          </div>
        </div>

        <div className="relative h-6 overflow-hidden rounded-full border border-myth-border bg-myth-surface-sunken">
          <div
            className="absolute left-0 top-0 h-full bg-myth-accent transition-all duration-500"
            style={{ width: `${completionPercentage}%` }}
          />
        </div>

        <div className="mt-4 flex items-center gap-6 text-sm text-myth-ink-muted">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-myth-good" />
            <span>{steps.filter(s => s.userProgress?.status === 'COMPLETED').length} Completed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-myth-accent" />
            <span>{steps.filter(s => s.userProgress?.status === 'IN_PROGRESS').length} In Progress</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-myth-surface-sunken border border-myth-border" />
            <span>{steps.filter(s => !s.userProgress || s.userProgress.status === 'NOT_STARTED').length} Not Started</span>
          </div>
        </div>
      </div>

      {/* Tutorial Steps by Category — a genuine checklist with per-item
          actions (Skip), stays bordered/reference throughout. */}
      <div className="space-y-6">
        {categoryOrder.map(category => {
          const categorySteps = groupedSteps[category] || []
          if (categorySteps.length === 0) return null

          return (
            <div key={category} className="rounded-lg border border-myth-border bg-myth-surface p-6">
              <div className="mb-6 flex items-center gap-3">
                <div className="text-4xl">{categoryIcons[category as keyof typeof categoryIcons]}</div>
                <h2 className="text-2xl font-bold text-myth-ink">
                  {categoryLabels[category as keyof typeof categoryLabels]}
                </h2>
              </div>

              <div className="space-y-3">
                {categorySteps.map((step, index) => {
                  const status = step.userProgress?.status || 'NOT_STARTED'
                  const isCompleted = status === 'COMPLETED'
                  const isSkipped = status === 'SKIPPED'
                  const isInProgress = status === 'IN_PROGRESS'

                  return (
                    <div
                      key={step.id}
                      className={`group relative rounded-lg border p-5 transition-colors ${
                        isCompleted
                          ? 'border-myth-good/30 bg-myth-good/10'
                          : isSkipped
                          ? 'border-myth-border bg-myth-surface-sunken'
                          : isInProgress
                          ? 'border-myth-accent/40 bg-myth-accent/5'
                          : 'border-myth-border hover:border-myth-border-strong'
                      }`}
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex flex-1 items-start gap-4">
                          <div className="mt-0.5 flex-shrink-0">
                            {isCompleted ? (
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-myth-good">
                                <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            ) : isSkipped ? (
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-myth-surface-sunken">
                                <svg className="h-4 w-4 text-myth-ink-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                                </svg>
                              </div>
                            ) : isInProgress ? (
                              <div className="flex h-6 w-6 animate-pulse items-center justify-center rounded-full bg-myth-accent">
                                <svg className="h-4 w-4 text-myth-accent-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </div>
                            ) : (
                              <div className="h-6 w-6 rounded-full border-2 border-myth-border" />
                            )}
                          </div>

                          <div className="flex-1">
                            <div className="mb-1 flex items-center gap-2">
                              <h3 className="text-lg font-bold text-myth-ink">{step.title}</h3>
                              {step.isOptional && (
                                <span className="rounded-full border border-myth-border bg-myth-surface-sunken px-2 py-0.5 text-xs font-semibold text-myth-ink-faint">
                                  Optional
                                </span>
                              )}
                            </div>
                            <p className="text-sm leading-relaxed text-myth-ink-muted">{step.description}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {status === 'NOT_STARTED' && step.isOptional && (
                            <Button
                              variant="secondary"
                              onClick={() => handleSkipStep(step.id)}
                            >
                              Skip
                            </Button>
                          )}

                          {isCompleted && step.userProgress?.completedAt && (
                            <div className="text-xs font-medium text-myth-good">
                              ✓ {new Date(step.userProgress.completedAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Help Text */}
      <div className="mt-8 rounded-lg border border-myth-border bg-myth-surface p-6">
        <div className="flex items-start gap-4">
          <div className="text-3xl">💡</div>
          <div>
            <h3 className="mb-3 text-lg font-bold text-myth-ink">How the Tutorial Works</h3>
            <ul className="space-y-2 text-sm text-myth-ink-muted">
              <li className="flex items-start gap-2">
                <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-myth-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Tutorial steps complete automatically as you use features</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-myth-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Optional steps can be skipped if you already know the feature</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-myth-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Required steps must be completed to reach 100%</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-myth-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Return to this page anytime to track your progress</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
      </main>

      <TavernNav campaignId={lastCampaignId || undefined} variant="myth" />
    </TavernPage>
  )
}
