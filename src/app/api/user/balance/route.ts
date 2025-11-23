// src/app/api/user/balance/route.ts
// Get user's current balance and transaction history
// GET /api/user/balance

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { getUserBalance, getTransactionHistory, formatCurrency } from '@/lib/payment/service'

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
    const user = requireAuth(request)

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
    console.error('Error fetching balance:', error)

    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    return NextResponse.json<ErrorResponse>(
      {
        error: 'Failed to fetch balance',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
