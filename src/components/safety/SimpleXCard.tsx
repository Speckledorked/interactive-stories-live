'use client'

import { useState } from 'react'
import { authenticatedFetch } from '@/lib/clientAuth'
import { Button } from '@/components/ui/button'

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
      <Button variant="danger"
        onClick={() => setIsOpen(true)}
        title="Use X-Card to pause/rewind uncomfortable content"
      >
        <span className="text-xl">✋</span>
        X-Card
      </Button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-myth-surface-raised rounded-lg p-6 max-w-md w-full border-2 border-myth-danger">
            {!submitted ? (
              <>
                <h2 className="font-display text-2xl font-bold mb-4 text-myth-danger">Use X-Card</h2>

                <div className="bg-myth-danger/10 border border-myth-danger/30 rounded-lg p-4 mb-4">
                  <p className="text-myth-ink text-sm">
                    The X-Card allows you to pause or rewind content that makes you uncomfortable.
                    Your safety and comfort are the priority. Use this tool freely - no explanation needed.
                  </p>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-myth-ink-muted mb-2">
                    What triggered this? (optional)
                  </label>
                  <select
                    value={trigger}
                    onChange={(e) => setTrigger(e.target.value)}
                    className="w-full px-3 py-2 bg-myth-surface-sunken border border-myth-border rounded-lg text-myth-ink focus:outline-none focus:border-myth-danger"
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
                  <label className="block text-sm font-medium text-myth-ink-muted mb-2">
                    Additional details (optional, anonymous)
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="You don't need to explain, but you can if it helps..."
                    className="w-full px-3 py-2 bg-myth-surface-sunken border border-myth-border rounded-lg text-myth-ink placeholder-myth-ink-faint focus:outline-none focus:border-myth-danger resize-none"
                    rows={3}
                  />
                </div>

                <div className="flex gap-3">
                  <Button variant="danger" fullWidth
                    onClick={useXCard}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Using X-Card...' : 'Use X-Card'}
                  </Button>
                  <Button variant="secondary"
                    onClick={() => {
                      setIsOpen(false)
                      setReason('')
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                <div className="text-6xl mb-4">✅</div>
                <h3 className="font-display text-2xl text-myth-ink mb-2">X-Card Used</h3>
                <p className="text-myth-ink-muted">
                  The rest of the table has been notified. The scene will be adjusted.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
