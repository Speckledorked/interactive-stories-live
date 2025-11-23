// src/components/BalanceDisplay.tsx
// Display user's balance and add funds button

'use client'

import { useState, useEffect } from 'react'
import { authenticatedFetch } from '@/lib/clientAuth'

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

      if (response.ok) {
        setSuccess(data.message)
        setBalance(data.newBalance)
        setBalanceFormatted(data.newBalanceFormatted)
        setAddAmount('0.50')
        setTimeout(() => {
          setShowAddFunds(false)
          setSuccess('')
        }, 2000)
      } else {
        setError(data.error || 'Failed to add funds')
      }
    } catch (err) {
      setError('Failed to add funds. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const getBalanceColorClass = () => {
    if (balance < 10) return 'text-danger-400' // Less than $0.10
    if (balance < 50) return 'text-warning-400' // Less than $0.50
    return 'text-success-400'
  }

  return (
    <div className="relative">
      {/* Balance Display */}
      <button
        onClick={() => setShowAddFunds(!showAddFunds)}
        className="flex items-center gap-2 px-3 py-1.5 bg-dark-800/50 rounded-lg border border-dark-700/50 hover:bg-dark-800 transition-all duration-200"
        title="Click to add funds"
      >
        <svg
          className="w-4 h-4 text-gray-400"
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
      </button>

      {/* Add Funds Modal */}
      {showAddFunds && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setShowAddFunds(false)}
          />

          {/* Modal */}
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md">
            <div className="bg-gradient-to-br from-dark-850 to-dark-900 border border-dark-700/50 rounded-2xl shadow-elevated p-6 animate-scale-in">
              <h3 className="text-xl font-bold text-white mb-4">Add Funds</h3>

              <div className="mb-4">
                <p className="text-sm text-gray-400 mb-2">
                  Current Balance:{' '}
                  <span className={`font-bold ${getBalanceColorClass()}`}>
                    {balanceFormatted}
                  </span>
                </p>
                <p className="text-xs text-gray-500">
                  AI scene resolutions cost $0.05 each
                </p>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Amount to Add (minimum $0.50)
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      $
                    </span>
                    <input
                      type="number"
                      min="0.50"
                      step="0.50"
                      value={addAmount}
                      onChange={(e) => setAddAmount(e.target.value)}
                      className="w-full pl-7 pr-4 py-2 bg-dark-800 border border-dark-700 rounded-lg text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none transition-all"
                      disabled={isLoading}
                    />
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  {['0.50', '1.00', '5.00', '10.00'].map((amount) => (
                    <button
                      key={amount}
                      onClick={() => setAddAmount(amount)}
                      className="px-3 py-1 text-xs bg-dark-800 hover:bg-dark-700 text-gray-300 rounded-lg transition-all"
                      disabled={isLoading}
                    >
                      ${amount}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-danger-500/10 border border-danger-500/50 rounded-lg">
                  <p className="text-sm text-danger-400">{error}</p>
                </div>
              )}

              {success && (
                <div className="mb-4 p-3 bg-success-500/10 border border-success-500/50 rounded-lg">
                  <p className="text-sm text-success-400">{success}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleAddFunds}
                  disabled={isLoading}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 text-white font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Processing...' : 'Add Funds'}
                </button>
                <button
                  onClick={() => setShowAddFunds(false)}
                  disabled={isLoading}
                  className="px-4 py-2 bg-dark-800 hover:bg-dark-700 text-gray-300 font-medium rounded-lg transition-all duration-200"
                >
                  Cancel
                </button>
              </div>

              <p className="text-xs text-gray-500 mt-4 text-center">
                Note: This is a demo implementation. In production, you would integrate
                with a payment processor like Stripe.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
