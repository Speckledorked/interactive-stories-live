// src/app/api/user/balance/add/route.ts
// Create Stripe checkout session for adding funds
// POST /api/user/balance/add

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { stripe } from '@/lib/stripe'
import { ErrorResponse } from '@/types/api'
import { MINIMUM_ADD_AMOUNT, formatCurrency } from '@/lib/payment/service'
import { getAppUrl } from '@/lib/appUrl'
import { handleRouteErrorWithDetails } from '@/lib/api/errors'
import { checkRateLimit, rateLimitExceededResponse, BALANCE_CHECKOUT_LIMIT } from '@/lib/rateLimit'

interface AddFundsRequest {
  amountInCents: number
}

interface AddFundsResponse {
  checkoutUrl: string
  sessionId: string
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request)

    // #210: caps how many Stripe checkout sessions one account can spin up
    // — cheap to abuse otherwise (each call hits the real Stripe API).
    const rateLimit = await checkRateLimit(user.userId, BALANCE_CHECKOUT_LIMIT.bucket, BALANCE_CHECKOUT_LIMIT.limit, BALANCE_CHECKOUT_LIMIT.windowSeconds)
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

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

    // Get the app URL for redirect
    const appUrl = getAppUrl()

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

    return NextResponse.json<AddFundsResponse>({
      checkoutUrl: session.url,
      sessionId: session.id,
    })
  } catch (error) {
    return handleRouteErrorWithDetails(error, 'Error creating checkout session', 'Failed to create checkout session')
  }
}
