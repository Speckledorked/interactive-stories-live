// src/lib/payment/__tests__/welcomeCredit.test.ts
//
// The welcome credit is the one place this product gives money away, on a
// signup flow open to anyone. These tests pin the two things that bound it:
// it stops at a budget, and a failure never propagates into the caller.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { transaction: { count: vi.fn() } },
}))
vi.mock('../service', () => ({
  addFunds: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { addFunds } from '../service'
import {
  grantWelcomeCredit,
  countWelcomeCreditsGranted,
  WELCOME_CREDIT_CENTS,
  WELCOME_CREDIT_BUDGET_CENTS,
  WELCOME_CREDIT_DESCRIPTION,
} from '../welcomeCredit'

const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  db.transaction.count.mockResolvedValue(0)
  ;(addFunds as any).mockResolvedValue({ success: true, newBalance: WELCOME_CREDIT_CENTS })
})

describe('countWelcomeCreditsGranted', () => {
  it('counts from the ledger, matching on the exact description', async () => {
    // Counting ledger rows rather than users is what makes historical grants
    // (paid at signup, before the credit moved) count against the budget
    // without a backfill.
    db.transaction.count.mockResolvedValue(7)
    expect(await countWelcomeCreditsGranted()).toBe(7 * WELCOME_CREDIT_CENTS)
    expect(db.transaction.count).toHaveBeenCalledWith({
      where: { type: 'CREDIT', description: WELCOME_CREDIT_DESCRIPTION },
    })
  })
})

describe('grantWelcomeCredit', () => {
  it('pays the credit while the budget has room', async () => {
    const result = await grantWelcomeCredit('user1')
    expect(result.granted).toBe(true)
    expect(addFunds).toHaveBeenCalledWith('user1', WELCOME_CREDIT_CENTS, WELCOME_CREDIT_DESCRIPTION)
  })

  it('stops paying once the budget is spent, without turning anyone away', async () => {
    db.transaction.count.mockResolvedValue(WELCOME_CREDIT_BUDGET_CENTS / WELCOME_CREDIT_CENTS)
    const result = await grantWelcomeCredit('user1')
    expect(result).toEqual({ granted: false, reason: 'budget-exhausted' })
    expect(addFunds).not.toHaveBeenCalled()
  })

  it('refuses the grant that would cross the budget, not the one after it', async () => {
    // One short of the cap: the next grant lands exactly on it and is
    // allowed. An off-by-one here spends a dollar past a ceiling whose
    // whole purpose is being exact.
    db.transaction.count.mockResolvedValue(WELCOME_CREDIT_BUDGET_CENTS / WELCOME_CREDIT_CENTS - 1)
    expect((await grantWelcomeCredit('user1')).granted).toBe(true)
  })

  it('reports failure rather than throwing when funding fails', async () => {
    // The caller is mid-verification. A payment problem must not turn a
    // successful verification into a failed one.
    ;(addFunds as any).mockResolvedValue({ success: false, newBalance: 0, error: 'nope' })
    expect(await grantWelcomeCredit('user1')).toEqual({ granted: false, reason: 'failed' })
  })

  it('swallows a thrown error from the payment layer', async () => {
    ;(addFunds as any).mockRejectedValue(new Error('payment service down'))
    await expect(grantWelcomeCredit('user1')).resolves.toEqual({ granted: false, reason: 'failed' })
  })
})
