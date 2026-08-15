// src/components/BalanceDisplay.tsx
// Display user's balance and add funds button

'use client'

import { useState, useEffect } from 'react'
import { authenticatedFetch } from '@/lib/clientAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface BalanceDisplayProps {
  userId: string
}

export default function BalanceDisplay({ userId }: BalanceDisplayProps) {
  const [balance, setBalance] = useState<number>(0)
  const [balanceFormatted, setBalanceFormatted] = useState<string>('$0.00')
  const [showAddFunds, setShowAddFunds] = useState(false)
  const [addAmount, setAddAmount] = useState<string>('0.50')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')

  useEffect(() => {
    loadBalance()
  }, [userId])

  const loadBalance = async () => {
    try {
      const response = await authenticatedFetch('/api/user/balance')
      if (response.ok) {
        const data = await response.json()
        setBalance(data.balance)
        setBalanceFormatted(data.balanceFormatted)
      }
    } catch (err) {
      console.error('Failed to load balance:', err)
    }
  }

  const handleAddFunds = async () => {
    setError('')
    setSuccess('')
    setIsLoading(true)

    const amountFloat = parseFloat(addAmount)
    if (isNaN(amountFloat) || amountFloat < 0.5) {
      setError('Minimum amount is $0.50')
      setIsLoading(false)
      return
    }

    const amountInCents = Math.round(amountFloat * 100)

    try {
      const response = await authenticatedFetch('/api/user/balance/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ amountInCents })
      })

      const data = await response.json()

      if (response.ok && data.checkoutUrl) {
        // Redirect to Stripe Checkout
        window.location.href = data.checkoutUrl
      } else {
        setError(data.error || 'Failed to create checkout session')
        setIsLoading(false)
      }
    } catch (err) {
      setError('Failed to create checkout session. Please try again.')
      setIsLoading(false)
    }
  }

  const getBalanceColorClass = () => {
    if (balance < 25) return 'text-myth-danger' // Less than $0.25 - can't afford even solo play
    if (balance < 75) return 'text-myth-warn' // Less than $0.75 - can afford solo/small but not large groups
    return 'text-myth-good' // Can afford any scene type
  }

  return (
    <div className="relative">
      {/* Balance Display */}
      <Button
        variant="secondary"
        onClick={() => setShowAddFunds(!showAddFunds)}
        title="Click to add funds"
      >
        <svg
          className="w-4 h-4 text-myth-ink-faint"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span className={`text-sm font-bold ${getBalanceColorClass()}`}>
          {balanceFormatted}
        </span>
      </Button>

      {/* Add Funds Modal */}
      {showAddFunds && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setShowAddFunds(false)}
          />

          {/* Modal */}
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md">
            <div className="rounded-lg border border-myth-border bg-myth-surface-raised p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.16)]">
              <h3 className="mb-4 text-xl font-bold text-myth-ink">Add Funds</h3>

              <div className="mb-4">
                <p className="mb-2 text-sm text-myth-ink-muted">
                  Current Balance:{' '}
                  <span className={`font-bold ${getBalanceColorClass()}`}>
                    {balanceFormatted}
                  </span>
                </p>
                <div className="space-y-1 text-xs text-myth-ink-faint">
                  <p className="mb-1 font-semibold text-myth-ink-muted">AI Scene Resolution Pricing:</p>
                  <p>• Solo play (1 player): $0.25 per scene</p>
                  <p>• Small group (2-4 players): $0.50 per scene</p>
                  <p>• Large group (5-6 players): $0.75 per scene</p>
                </div>
              </div>

              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-myth-ink-muted">
                  Amount to Add (minimum $0.50)
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-myth-ink-faint">
                      $
                    </span>
                    <Input
                      wrapperClassName="w-full" className="pl-7 pr-4"
                      type="number"
                      min="0.50"
                      step="0.50"
                      value={addAmount}
                      onChange={(e) => setAddAmount(e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                </div>
                <div className="mt-2 flex gap-2">
                  {['0.50', '1.00', '5.00', '10.00'].map((amount) => (
                    <Button
                      variant="secondary" size="sm"
                      key={amount}
                      onClick={() => setAddAmount(amount)}
                      disabled={isLoading}
                    >
                      ${amount}
                    </Button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="mb-4 rounded-lg border border-myth-danger/30 bg-myth-danger/10 p-3">
                  <p className="text-sm text-myth-danger">{error}</p>
                </div>
              )}

              {success && (
                <div className="mb-4 rounded-lg border border-myth-good/30 bg-myth-good/10 p-3">
                  <p className="text-sm text-myth-good">{success}</p>
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  variant="primary" fullWidth
                  onClick={handleAddFunds}
                  disabled={isLoading}
                >
                  {isLoading ? 'Processing...' : 'Add Funds'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setShowAddFunds(false)}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
              </div>

              <p className="mt-4 text-center text-xs text-myth-ink-faint">
                Payments are securely processed by Stripe.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
