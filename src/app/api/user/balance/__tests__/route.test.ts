// src/app/api/user/balance/__tests__/route.test.ts
// #135 (cont.) — the balance/transaction-history read had no test
// coverage: the auth gate, and that each transaction's raw amount is
// formatted with its absolute value (a negative debit shouldn't render
// as "-$-5.00") while the top-level balance formats its real signed
// value, were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/payment/service', () => ({
  getUserBalance: vi.fn(),
  getTransactionHistory: vi.fn(),
  formatCurrency: vi.fn((cents: number) => `$${(cents / 100).toFixed(2)}`),
}))

import { requireAuth } from '@/lib/auth'
import { getUserBalance, getTransactionHistory } from '@/lib/payment/service'
import { GET } from '../route'

function req() {
  return new NextRequest('http://localhost/api/user/balance')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'u1' })
  ;(getUserBalance as any).mockResolvedValue(500)
  ;(getTransactionHistory as any).mockResolvedValue([])
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
    const response = await GET(req())
    expect(response.status).toBe(401)
  })

  it('fetches up to 50 transactions', async () => {
    await GET(req())
    expect(getTransactionHistory).toHaveBeenCalledWith('u1', 50)
  })

  it('formats a negative debit amount by its absolute value', async () => {
    ;(getTransactionHistory as any).mockResolvedValue([
      { id: 't1', type: 'DEBIT', amount: -500, description: 'Scene resolution', balanceBefore: 1000, balanceAfter: 500, createdAt: new Date('2026-01-01') },
    ])
    const response = await GET(req())
    const body = await response.json()
    expect(body.transactions[0].amount).toBe(-500)
    expect(body.transactions[0].amountFormatted).toBe('$5.00')
  })

  it('formats the top-level balance with its real signed value', async () => {
    ;(getUserBalance as any).mockResolvedValue(500)
    const response = await GET(req())
    const body = await response.json()
    expect(body.balance).toBe(500)
    expect(body.balanceFormatted).toBe('$5.00')
  })

  it('returns 500 on an unexpected error', async () => {
    ;(getUserBalance as any).mockRejectedValue(new Error('db down'))
    const response = await GET(req())
    expect(response.status).toBe(500)
  })
})
