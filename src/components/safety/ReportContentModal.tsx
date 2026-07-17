'use client'

import { useState } from 'react'
import { authenticatedFetch } from '@/lib/clientAuth'

interface ReportContentModalProps {
  campaignId: string
}

const CONTENT_TYPES: Array<{ value: string; label: string }> = [
  { value: 'message', label: 'A chat message' },
  { value: 'character_action', label: 'A character action' },
  { value: 'scene', label: 'Scene content' },
  { value: 'user_behavior', label: 'A player\'s behavior' },
  { value: 'other', label: 'Something else' },
]

// Distinct from the X-Card: this is "please have a GM review this," not
// "pause, I'm uncomfortable." It always requires a reason and stays queued
// until an admin resolves or dismisses it (see the campaign admin Safety tab).
export default function ReportContentModal({ campaignId }: ReportContentModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [contentType, setContentType] = useState('message')
  const [contentText, setContentText] = useState('')
  const [reason, setReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const submitReport = async () => {
    if (!reason.trim()) {
      setError('Please describe what happened.')
      return
    }
    setError('')
    setIsSubmitting(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentType,
          contentText: contentText || undefined,
          reason,
        }),
      })

      if (response.ok) {
        setSubmitted(true)
        setTimeout(() => {
          setIsOpen(false)
          setSubmitted(false)
          setReason('')
          setContentText('')
        }, 2500)
      } else {
        const data = await response.json().catch(() => ({}))
        setError(data.error || 'Failed to submit report. Please try again.')
      }
    } catch (err) {
      setError('Failed to submit report. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 border-2 border-ember-700/50 text-ember-300 hover:bg-ember-900/30 rounded-lg transition-colors font-medium flex items-center gap-2"
        title="Report content or behavior to the GM"
      >
        <span className="text-xl">🚩</span>
        Report
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-tavern-800 to-tavern-950 rounded-lg p-6 max-w-md w-full border-2 border-ember-700/50">
            {!submitted ? (
              <>
                <h2 className="text-2xl font-bold mb-4 text-ember-100">Report Content</h2>
                <p className="text-sm text-ember-300/60 mb-4">
                  Flag something for the GM to review — this goes to the campaign&apos;s moderation queue, not just the GM&apos;s attention in the moment.
                </p>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-ember-200/80 mb-2">What is this about?</label>
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value)}
                    className="w-full px-3 py-2 bg-black/30 border border-ember-900/40 rounded-lg text-ember-100 focus:outline-none focus:border-ember-500"
                  >
                    {CONTENT_TYPES.map(ct => (
                      <option key={ct.value} value={ct.value}>{ct.label}</option>
                    ))}
                  </select>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-ember-200/80 mb-2">
                    Quote or describe the content (optional)
                  </label>
                  <textarea
                    value={contentText}
                    onChange={(e) => setContentText(e.target.value)}
                    placeholder="Paste the message or describe what happened..."
                    className="w-full px-3 py-2 bg-black/30 border border-ember-900/40 rounded-lg text-ember-100 placeholder-ember-500/40 focus:outline-none focus:border-ember-500 resize-none"
                    rows={2}
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-ember-200/80 mb-2">Why are you reporting this?</label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Explain what's wrong so the GM can act on it..."
                    className="w-full px-3 py-2 bg-black/30 border border-ember-900/40 rounded-lg text-ember-100 placeholder-ember-500/40 focus:outline-none focus:border-ember-500 resize-none"
                    rows={3}
                  />
                </div>

                {error && <p className="text-sm text-wine-400 mb-3">{error}</p>}

                <div className="flex gap-3">
                  <button
                    onClick={submitReport}
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2 bg-ember-700 hover:bg-ember-600 disabled:bg-ember-900 text-white rounded-lg font-medium transition-colors"
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Report'}
                  </button>
                  <button
                    onClick={() => {
                      setIsOpen(false)
                      setError('')
                    }}
                    className="px-4 py-2 bg-black/30 hover:bg-black/40 border border-ember-900/40 text-ember-200 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                <div className="text-6xl mb-4">✅</div>
                <h3 className="text-2xl font-bold text-ember-100 mb-2">Report Submitted</h3>
                <p className="text-ember-200/70">The GM will review this in their moderation queue.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
