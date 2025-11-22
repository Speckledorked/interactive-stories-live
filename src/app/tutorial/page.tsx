'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authenticatedFetch, isAuthenticated, getUser } from '@/lib/clientAuth'
import Link from 'next/link'

interface TutorialStep {
  id: string
  stepKey: string
  title: string
  description: string
  category: string
  orderIndex: number
  isOptional: boolean
  userProgress: {
    status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED'
    completedAt?: string
    skippedAt?: string
  } | null
}

export default function TutorialPage() {
  const router = useRouter()
  const [steps, setSteps] = useState<TutorialStep[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [completionPercentage, setCompletionPercentage] = useState(0)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    loadTutorialProgress()
  }, [])

  const loadTutorialProgress = async () => {
    try {
      const response = await authenticatedFetch('/api/tutorial/progress')
      if (response.ok) {
        const data = await response.json()
        setSteps(data.steps || [])
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
      <div className="flex justify-center items-center min-h-[60vh]">
        <div className="relative">
          <div className="spinner h-16 w-16"></div>
          <div className="absolute inset-0 h-16 w-16 rounded-full bg-primary-500/20 animate-ping"></div>
        </div>
      </div>
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
    <div className="max-w-6xl mx-auto animate-fade-in">
      <div className="mb-12">
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition-colors group"
        >
          <svg className="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Campaigns
        </Link>

        <div className="relative">
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-primary-500/10 via-accent-500/5 to-transparent blur-3xl"></div>
          <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent mb-3">
            Tutorial & Onboarding
          </h1>
          <p className="text-lg text-gray-400">
            Master the art of AI-powered tabletop adventures
          </p>
        </div>
      </div>

      {/* Progress Card */}
      <div className="card mb-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-primary-500/10 to-transparent blur-3xl"></div>
        <div className="relative">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">Your Progress</h2>
            <div className="badge badge-primary text-lg px-4 py-2">
              {completionPercentage}%
            </div>
          </div>

          <div className="relative h-6 bg-dark-900/50 rounded-full overflow-hidden backdrop-blur-sm border border-dark-700/50">
            <div
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-primary-600 via-primary-500 to-primary-400 transition-all duration-500 shadow-glow"
              style={{ width: `${completionPercentage}%` }}
            >
              <div className="absolute inset-0 bg-shimmer animate-shimmer"></div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-6 text-sm text-gray-400">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-success-500"></div>
              <span>{steps.filter(s => s.userProgress?.status === 'COMPLETED').length} Completed</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-primary-500"></div>
              <span>{steps.filter(s => s.userProgress?.status === 'IN_PROGRESS').length} In Progress</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gray-600"></div>
              <span>{steps.filter(s => !s.userProgress || s.userProgress.status === 'NOT_STARTED').length} Not Started</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tutorial Steps by Category */}
      <div className="space-y-6">
        {categoryOrder.map(category => {
          const categorySteps = groupedSteps[category] || []
          if (categorySteps.length === 0) return null

          return (
            <div key={category} className="card">
              <div className="flex items-center gap-3 mb-6">
                <div className="text-4xl">{categoryIcons[category as keyof typeof categoryIcons]}</div>
                <h2 className="text-2xl font-bold text-white">
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
                      className={`group relative p-5 rounded-xl border transition-all duration-200 ${
                        isCompleted
                          ? 'bg-gradient-to-r from-success-500/10 to-transparent border-success-500/30 shadow-sm'
                          : isSkipped
                          ? 'bg-dark-800/30 border-dark-700/50'
                          : isInProgress
                          ? 'bg-gradient-to-r from-primary-500/10 to-transparent border-primary-500/30 shadow-sm'
                          : 'bg-dark-800/50 border-dark-700/50 hover:border-dark-600 hover:bg-dark-800/70'
                      }`}
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4 flex-1">
                          <div className="flex-shrink-0 mt-0.5">
                            {isCompleted ? (
                              <div className="w-6 h-6 rounded-full bg-success-500 flex items-center justify-center shadow-lg shadow-success-500/30">
                                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            ) : isSkipped ? (
                              <div className="w-6 h-6 rounded-full bg-gray-600 flex items-center justify-center">
                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                                </svg>
                              </div>
                            ) : isInProgress ? (
                              <div className="w-6 h-6 rounded-full bg-primary-500 flex items-center justify-center shadow-lg shadow-primary-500/30 animate-pulse">
                                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </div>
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-dark-700 border-2 border-dark-600"></div>
                            )}
                          </div>

                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-bold text-white text-lg">{step.title}</h3>
                              {step.isOptional && (
                                <span className="badge bg-dark-700/50 border-dark-600 text-gray-400">
                                  Optional
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-400 leading-relaxed">{step.description}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {status === 'NOT_STARTED' && step.isOptional && (
                            <button
                              onClick={() => handleSkipStep(step.id)}
                              className="px-4 py-2 bg-dark-800 hover:bg-dark-700 text-gray-300 rounded-lg text-sm font-medium transition-all duration-200 hover:scale-105"
                            >
                              Skip
                            </button>
                          )}

                          {isCompleted && step.userProgress?.completedAt && (
                            <div className="text-xs text-success-400 font-medium">
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
      <div className="card mt-8 bg-gradient-to-br from-primary-900/20 to-accent-900/10 border-primary-700/30">
        <div className="flex items-start gap-4">
          <div className="text-3xl">💡</div>
          <div>
            <h3 className="font-bold text-white mb-3 text-lg">How the Tutorial Works</h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-primary-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Tutorial steps complete automatically as you use features</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-primary-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Optional steps can be skipped if you already know the feature</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-primary-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Required steps must be completed to reach 100%</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-primary-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Return to this page anytime to track your progress</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
