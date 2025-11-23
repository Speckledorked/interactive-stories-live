// src/lib/stripe.ts
// Stripe configuration and initialization

import Stripe from 'stripe'

// Lazy initialization of Stripe to avoid build-time environment variable checks
let stripeInstance: Stripe | null = null

function getStripeInstance(): Stripe {
  if (!stripeInstance) {
    // Initialize Stripe with secret key (server-side only)
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not set in environment variables')
    }

    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-11-17.clover',
      typescript: true,
    })
  }

  return stripeInstance
}

// Export a proxy that lazily initializes Stripe on first access
export const stripe = new Proxy({} as Stripe, {
  get: (_target, prop) => {
    const instance = getStripeInstance()
    const value = instance[prop as keyof Stripe]
    // Bind methods to the instance to maintain 'this' context
    return typeof value === 'function' ? value.bind(instance) : value
  }
})

// Publishable key for client-side
export const getStripePublishableKey = () => {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY
  if (!key) {
    throw new Error('Stripe publishable key is not set in environment variables')
  }
  return key
}

// Webhook secret for verifying webhook signatures
export const getStripeWebhookSecret = () => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set in environment variables')
  }
  return secret
}
