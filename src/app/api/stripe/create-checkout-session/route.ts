// src/app/api/stripe/create-checkout-session/route.ts
// Create a Stripe Checkout session for adding funds
// POST /api/stripe/create-checkout-session

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { stripe } from '@/lib/stripe'
import { ErrorResponse } from '@/types/api'
import { MINIMUM_ADD_AMOUNT, formatCurrency } from '@/lib/payment/service'

interface CreateCheckoutSessionRequest {
  amountInCents: number
}

interface CreateCheckoutSessionResponse {
  sessionId: string
  url: string
}

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request)
    const body: CreateCheckoutSessionRequest = await request.json()

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

    // Get the app URL for redirect
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Account Balance',
              description: `Add ${formatCurrency(body.amountInCents)} to your account`,
            },
            unit_amount: body.amountInCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${appUrl}?payment=success`,
      cancel_url: `${appUrl}?payment=cancelled`,
      client_reference_id: user.userId,
      metadata: {
        userId: user.userId,
        amountInCents: body.amountInCents.toString(),
        type: 'add_funds',
      },
    })

    if (!session.url) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Failed to create checkout session' },
        { status: 500 }
      )
    }

    return NextResponse.json<CreateCheckoutSessionResponse>({
      sessionId: session.id,
      url: session.url,
    })
  } catch (error) {
    console.error('Error creating checkout session:', error)

    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    return NextResponse.json<ErrorResponse>(
      {
        error: 'Failed to create checkout session',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
