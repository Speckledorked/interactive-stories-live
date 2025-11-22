'use client'

import { useState } from 'react'
import { authenticatedFetch } from '@/lib/clientAuth'

interface SimpleXCardProps {
  campaignId: string
  sceneId?: string
}

export default function SimpleXCard({ campaignId, sceneId }: SimpleXCardProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [trigger, setTrigger] = useState<string>('GENERAL')
  const [reason, setReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const useXCard = async () => {
    setIsSubmitting(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/xcard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trigger,
          reason: reason || undefined,
          sceneId,
        }),
      })

      if (response.ok) {
        setSubmitted(true)
        setTimeout(() => {
          setIsOpen(false)
          setSubmitted(false)
          setReason('')
        }, 3000)
      } else {
        alert('Failed to use X-Card. Please try again.')
      }
    } catch (error) {
      console.error('Error using X-Card:', error)
      alert('Error using X-Card. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 border-2 border-red-500 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors font-medium flex items-center gap-2"
        title="Use X-Card to pause/rewind uncomfortable content"
      >
        <span className="text-xl">✋</span>
        X-Card
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full border-2 border-red-500">
            {!submitted ? (
              <>
                <h2 className="text-2xl font-bold mb-4 text-red-400">Use X-Card</h2>

                <div className="bg-red-900/30 border border-red-500 rounded-lg p-4 mb-4">
                  <p className="text-red-200 text-sm">
                    The X-Card allows you to pause or rewind content that makes you uncomfortable.
                    Your safety and comfort are the priority. Use this tool freely - no explanation needed.
                  </p>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    What triggered this? (optional)
                  </label>
                  <select
                    value={trigger}
                    onChange={(e) => setTrigger(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-red-500"
                  >
                    <option value="GENERAL">General discomfort</option>
                    <option value="VIOLENCE">Violence</option>
                    <option value="GORE">Gore / Body horror</option>
                    <option value="TRAUMA">Traumatic content</option>
                    <option value="ABUSE">Abuse / Harassment</option>
                    <option value="DEATH">Death / Mortality</option>
                    <option value="PHOBIA">Phobia trigger</option>
                    <option value="SEXUAL">Sexual content</option>
                    <option value="SUBSTANCE">Substance use</option>
                    <option value="MENTAL_HEALTH">Mental health</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Additional details (optional, anonymous)
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="You don't need to explain, but you can if it helps..."
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-red-500 resize-none"
                    rows={3}
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={useXCard}
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800 text-white rounded-lg font-medium transition-colors"
                  >
                    {isSubmitting ? 'Using X-Card...' : 'Use X-Card'}
                  </button>
                  <button
                    onClick={() => {
                      setIsOpen(false)
                      setReason('')
                    }}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                <div className="text-6xl mb-4">✅</div>
                <h3 className="text-2xl font-bold text-white mb-2">X-Card Used</h3>
                <p className="text-gray-300">
                  The GM and other players have been notified. The scene will be adjusted.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
