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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
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

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <Link
          href="/campaigns"
          className="text-gray-400 hover:text-white text-sm mb-4 inline-block"
        >
          ← Back to Campaigns
        </Link>

        <h1 className="text-4xl font-bold text-white mb-2">Tutorial & Onboarding</h1>
        <p className="text-gray-400">
          Learn how to play AI-powered tabletop RPG adventures
        </p>
      </div>

      {/* Progress Bar */}
      <div className="card mb-8">
        <h2 className="text-xl font-bold text-white mb-4">Your Progress</h2>
        <div className="relative h-4 bg-gray-700 rounded-full overflow-hidden mb-2">
          <div
            className="absolute top-0 left-0 h-full bg-gradient-to-r from-primary-600 to-primary-400 transition-all duration-500"
            style={{ width: `${completionPercentage}%` }}
          />
        </div>
        <p className="text-sm text-gray-400 text-right">
          {completionPercentage}% Complete
        </p>
      </div>

      {/* Tutorial Steps by Category */}
      <div className="space-y-6">
        {categoryOrder.map(category => {
          const categorySteps = groupedSteps[category] || []
          if (categorySteps.length === 0) return null

          return (
            <div key={category} className="card">
              <h2 className="text-2xl font-bold text-white mb-4">
                {categoryLabels[category as keyof typeof categoryLabels]}
              </h2>

              <div className="space-y-3">
                {categorySteps.map(step => {
                  const status = step.userProgress?.status || 'NOT_STARTED'
                  const isCompleted = status === 'COMPLETED'
                  const isSkipped = status === 'SKIPPED'
                  const isInProgress = status === 'IN_PROGRESS'

                  return (
                    <div
                      key={step.id}
                      className={`p-4 rounded-lg border ${
                        isCompleted
                          ? 'bg-green-900/20 border-green-700'
                          : isSkipped
                          ? 'bg-gray-800/50 border-gray-700'
                          : isInProgress
                          ? 'bg-primary-900/20 border-primary-700'
                          : 'bg-gray-800 border-gray-700'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xl">
                              {isCompleted ? '✅' : isSkipped ? '⏭️' : isInProgress ? '▶️' : '⭕'}
                            </span>
                            <h3 className="font-bold text-white">{step.title}</h3>
                            {step.isOptional && (
                              <span className="text-xs px-2 py-0.5 bg-gray-700 text-gray-300 rounded">
                                Optional
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-400 ml-7">{step.description}</p>
                        </div>

                        <div className="flex items-center gap-2 ml-4">
                          {status === 'NOT_STARTED' && step.isOptional && (
                            <button
                              onClick={() => handleSkipStep(step.id)}
                              className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                            >
                              Skip
                            </button>
                          )}

                          {isCompleted && step.userProgress?.completedAt && (
                            <span className="text-xs text-green-400">
                              Completed{' '}
                              {new Date(step.userProgress.completedAt).toLocaleDateString()}
                            </span>
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
      <div className="card mt-8 bg-primary-900/20 border-primary-700">
        <h3 className="font-bold text-white mb-2">💡 How the Tutorial Works</h3>
        <ul className="text-sm text-gray-300 space-y-1">
          <li>• Tutorial steps complete automatically as you use features</li>
          <li>• Optional steps can be skipped if you already know the feature</li>
          <li>• Required steps must be completed to reach 100%</li>
          <li>• You can return to this page anytime to track your progress</li>
        </ul>
      </div>
    </div>
  )
}
