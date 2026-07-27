// src/app/api/user/balance/route.ts
// Get user's current balance and transaction history
// GET /api/user/balance

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { getUserBalance, getTransactionHistory, formatCurrency } from '@/lib/payment/service'
import { handleRouteErrorWithDetails } from '@/lib/api/errors'

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic'

interface BalanceResponse {
  balance: number
  balanceFormatted: string
  transactions: Array<{
    id: string
    type: string
    amount: number
    amountFormatted: string
    description: string
    balanceBefore: number
    balanceAfter: number
    createdAt: string
    metadata?: any
  }>
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request)

    // Get user's current balance
    const balance = await getUserBalance(user.userId)

    // Get transaction history
    const transactions = await getTransactionHistory(user.userId, 50)

    // Format response
    const response: BalanceResponse = {
      balance,
      balanceFormatted: formatCurrency(balance),
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        amountFormatted: formatCurrency(Math.abs(t.amount)),
        description: t.description,
        balanceBefore: t.balanceBefore,
        balanceAfter: t.balanceAfter,
        createdAt: t.createdAt.toISOString(),
        metadata: t.metadata
      }))
    }

    return NextResponse.json(response)
  } catch (error) {
    return handleRouteErrorWithDetails(error, 'Error fetching balance', 'Failed to fetch balance')
  }
}
