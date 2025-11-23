// src/lib/stripe.ts
// Stripe configuration and initialization

import Stripe from 'stripe'

// Initialize Stripe with secret key (server-side only)
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables')
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-11-17.clover',
  typescript: true,
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
