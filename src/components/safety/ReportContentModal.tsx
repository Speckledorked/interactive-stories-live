'use client'

import { useState } from 'react'
import { authenticatedFetch } from '@/lib/clientAuth'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'

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

// Distinct from the X-Card: this is "please have the host review this," not
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
      <Button
        variant="secondary"
        onClick={() => setIsOpen(true)}
        title="Report content or behavior to the campaign host"
      >
        <span className="text-xl">🚩</span>
        Report
      </Button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-myth-surface-raised rounded-lg p-6 max-w-md w-full border-2 border-myth-border">
            {!submitted ? (
              <>
                <h2 className="font-display text-2xl text-myth-ink mb-4">Report Content</h2>
                <p className="text-sm text-myth-ink-muted mb-4">
                  Flag something for the campaign host to review — this goes to the campaign&apos;s moderation queue, not just a chat message in the moment.
                </p>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-myth-ink-muted mb-2">What is this about?</label>
                  <Select
                    wrapperClassName="w-full"
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value)}
                  >
                    {CONTENT_TYPES.map(ct => (
                      <option key={ct.value} value={ct.value}>{ct.label}</option>
                    ))}
                  </Select>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-myth-ink-muted mb-2">
                    Quote or describe the content (optional)
                  </label>
                  <Textarea
                    wrapperClassName="w-full"
                    value={contentText}
                    onChange={(e) => setContentText(e.target.value)}
                    placeholder="Paste the message or describe what happened..."
                    rows={2}
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-myth-ink-muted mb-2">Why are you reporting this?</label>
                  <Textarea
                    wrapperClassName="w-full"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Explain what's wrong so the host can act on it..."
                    rows={3}
                  />
                </div>

                {error && <p className="text-sm text-myth-danger mb-3">{error}</p>}

                <div className="flex gap-3">
                  <Button
                    variant="primary" fullWidth
                    onClick={submitReport}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Report'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setIsOpen(false)
                      setError('')
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                <div className="text-6xl mb-4">✅</div>
                <h3 className="font-display text-2xl text-myth-ink mb-2">Report Submitted</h3>
                <p className="text-myth-ink-muted">The campaign host will review this in their moderation queue.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
