// src/app/api/stripe/webhook/route.ts
// Stripe webhook handler for processing payment events
// POST /api/stripe/webhook

import { NextRequest, NextResponse } from 'next/server'
import { stripe, getStripeWebhookSecret } from '@/lib/stripe'
import { addFunds, formatCurrency } from '@/lib/payment/service'
import Stripe from 'stripe'

// Disable body parsing, need raw body for webhook signature verification
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    console.error('Missing stripe-signature header')
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    )
  }

  let event: Stripe.Event

  try {
    // Verify webhook signature
    const webhookSecret = getStripeWebhookSecret()
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json(
      { error: `Webhook Error: ${err instanceof Error ? err.message : 'Unknown error'}` },
      { status: 400 }
    )
  }

  // Handle the event
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session

        // Get metadata
        const userId = session.metadata?.userId || session.client_reference_id
        const amountInCents = session.metadata?.amountInCents
        const type = session.metadata?.type

        if (!userId) {
          console.error('Missing userId in session metadata')
          return NextResponse.json(
            { error: 'Missing userId in session metadata' },
            { status: 400 }
          )
        }

        if (!amountInCents) {
          console.error('Missing amountInCents in session metadata')
          return NextResponse.json(
            { error: 'Missing amountInCents in session metadata' },
            { status: 400 }
          )
        }

        if (type !== 'add_funds') {
          console.error('Invalid type in session metadata:', type)
          return NextResponse.json(
            { error: 'Invalid type in session metadata' },
            { status: 400 }
          )
        }

        // Payment was successful, add funds to user account
        const amount = parseInt(amountInCents)
        const result = await addFunds(
          userId,
          amount,
          `Stripe payment: ${formatCurrency(amount)} (Session: ${session.id})`
        )

        if (!result.success) {
          console.error('Failed to add funds:', result.error)
          return NextResponse.json(
            { error: `Failed to add funds: ${result.error}` },
            { status: 500 }
          )
        }

        console.log(`Successfully added ${formatCurrency(amount)} to user ${userId}`)
        break
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        console.log('Payment failed:', paymentIntent.id)
        // You could send a notification to the user here
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('Error handling webhook event:', err)
    return NextResponse.json(
      { error: `Webhook handler failed: ${err instanceof Error ? err.message : 'Unknown error'}` },
      { status: 500 }
    )
  }
}
