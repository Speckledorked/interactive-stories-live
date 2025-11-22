'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';

interface XCardButtonProps {
  campaignId: string;
  sceneId?: string;
  className?: string;
}

export function XCardButton({ campaignId, sceneId, className }: XCardButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [trigger, setTrigger] = useState<string>('GENERAL');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const useXCard = async () => {
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/xcard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trigger,
          reason: reason || undefined,
          sceneId,
        }),
      });

      if (response.ok) {
        setSubmitted(true);
        setTimeout(() => {
          setIsOpen(false);
          setSubmitted(false);
          setReason('');
        }, 3000);
      } else {
        alert('Failed to use X-Card. Please try again.');
      }
    } catch (error) {
      console.error('Error using X-Card:', error);
      alert('Error using X-Card. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        variant="outline"
        className={`border-red-500 text-red-500 hover:bg-red-500 hover:text-white ${className}`}
      >
        <span className="text-2xl mr-2">✋</span>
        X-Card
      </Button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full border-2 border-red-500">
            {!submitted ? (
              <>
                <h2 className="text-2xl font-bold mb-4 text-red-400">Use X-Card</h2>

                <Alert className="bg-red-900/30 border-red-500 mb-4">
                  <p className="text-red-200">
                    The X-Card allows you to pause or rewind content that makes you uncomfortable.
                    Your safety and comfort are the priority. Use this tool freely - no explanation needed.
                  </p>
                </Alert>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    What triggered this? (optional)
                  </label>
                  <select
                    value={trigger}
                    onChange={(e) => setTrigger(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-gray-100"
                  >
                    <option value="GENERAL">General discomfort</option>
                    <option value="SCENE_CONTENT">Scene content</option>
                    <option value="MESSAGE">A message</option>
                    <option value="CHARACTER_ACTION">Character action</option>
                    <option value="NPC_BEHAVIOR">NPC behavior</option>
                  </select>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Additional context (optional, anonymous)
                  </label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="You can provide context if you'd like, but it's completely optional..."
                    className="bg-gray-700 border-gray-600 text-gray-100"
                    rows={3}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    This will be sent anonymously to the GM
                  </p>
                </div>

                <div className="flex gap-3 justify-end">
                  <Button
                    onClick={() => setIsOpen(false)}
                    variant="ghost"
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={useXCard}
                    disabled={isSubmitting}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    {isSubmitting ? 'Sending...' : 'Use X-Card'}
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                <div className="text-6xl mb-4">✋</div>
                <h3 className="text-2xl font-bold text-green-400 mb-2">X-Card Used</h3>
                <p className="text-gray-300">
                  The GM has been notified. The scene will pause while this is addressed.
                </p>
                <p className="text-sm text-gray-500 mt-4">
                  Thank you for speaking up. Your comfort matters.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
