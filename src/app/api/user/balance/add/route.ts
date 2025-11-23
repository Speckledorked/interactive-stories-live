// src/app/api/user/balance/add/route.ts
// Add funds to user account
// POST /api/user/balance/add

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { addFunds, MINIMUM_ADD_AMOUNT, formatCurrency } from '@/lib/payment/service'

interface AddFundsRequest {
  amountInCents: number
}

interface AddFundsResponse {
  success: boolean
  newBalance: number
  newBalanceFormatted: string
  message: string
}

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request)
    const body: AddFundsRequest = await request.json()

    // Validate amount
    if (!body.amountInCents || typeof body.amountInCents !== 'number') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Invalid amount' },
        { status: 400 }
      )
    }

    if (body.amountInCents < MINIMUM_ADD_AMOUNT) {
      return NextResponse.json<ErrorResponse>(
        {
          error: `Minimum amount is ${formatCurrency(MINIMUM_ADD_AMOUNT)}`,
          details: `You must add at least ${formatCurrency(MINIMUM_ADD_AMOUNT)} to your account`
        },
        { status: 400 }
      )
    }

    // Add funds to user account
    const result = await addFunds(
      user.userId,
      body.amountInCents,
      `Added ${formatCurrency(body.amountInCents)} to account`
    )

    if (!result.success) {
      return NextResponse.json<ErrorResponse>(
        { error: result.error || 'Failed to add funds' },
        { status: 500 }
      )
    }

    return NextResponse.json<AddFundsResponse>({
      success: true,
      newBalance: result.newBalance,
      newBalanceFormatted: formatCurrency(result.newBalance),
      message: `Successfully added ${formatCurrency(body.amountInCents)} to your account`
    })
  } catch (error) {
    console.error('Error adding funds:', error)

    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    return NextResponse.json<ErrorResponse>(
      {
        error: 'Failed to add funds',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
