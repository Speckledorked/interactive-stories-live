// src/lib/payment/service.ts
// Payment and balance management service

import { prisma } from '@/lib/prisma'

// Minimum balance to add (50 cents)
export const MINIMUM_ADD_AMOUNT = 50

// Player-based pricing for AI scene resolutions (in cents)
// Pricing structure:
// - Solo play (1 player): $0.25
// - Small group (2-4 players): $0.50
// - Large group (5-6 players): $0.75
// - 7+ players: $1.00 (fallback for edge cases)
export const PRICING = {
  SOLO: 25,        // $0.25
  SMALL_GROUP: 50, // $0.50
  LARGE_GROUP: 75, // $0.75
  EXTRA_LARGE: 100 // $1.00
} as const

/**
 * Calculate the cost for an AI scene resolution based on player count
 * @param playerCount - Number of players in the campaign
 * @returns Cost in cents
 */
export function calculateResolutionCost(playerCount: number): number {
  if (playerCount === 1) {
    return PRICING.SOLO
  } else if (playerCount >= 2 && playerCount <= 4) {
    return PRICING.SMALL_GROUP
  } else if (playerCount >= 5 && playerCount <= 6) {
    return PRICING.LARGE_GROUP
  } else {
    // 7+ players or edge cases
    return PRICING.EXTRA_LARGE
  }
}

/**
 * Add funds to a user's account
 * @param userId - The user's ID
 * @param amountInCents - Amount to add in cents (must be >= MINIMUM_ADD_AMOUNT)
 * @param description - Description of the transaction
 * @returns Updated balance
 */
export async function addFunds(
  userId: string,
  amountInCents: number,
  description: string = 'Funds added'
): Promise<{ success: boolean; newBalance: number; error?: string }> {
  if (amountInCents < MINIMUM_ADD_AMOUNT) {
    return {
      success: false,
      newBalance: 0,
      error: `Minimum amount to add is $${MINIMUM_ADD_AMOUNT / 100}`
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Get current user balance
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true }
      })

      if (!user) {
        throw new Error('User not found')
      }

      const balanceBefore = user.balance
      const balanceAfter = balanceBefore + amountInCents

      // Update user balance
      await tx.user.update({
        where: { id: userId },
        data: { balance: balanceAfter }
      })

      // Create transaction record
      await tx.transaction.create({
        data: {
          userId,
          type: 'CREDIT',
          amount: amountInCents,
          balanceBefore,
          balanceAfter,
          description
        }
      })

      return { newBalance: balanceAfter }
    })

    return {
      success: true,
      newBalance: result.newBalance
    }
  } catch (error) {
    console.error('Error adding funds:', error)
    return {
      success: false,
      newBalance: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Deduct funds from a user's account for AI usage
 * @param userId - The user's ID
 * @param amountInCents - Amount to deduct in cents
 * @param description - Description of the transaction
 * @param metadata - Additional metadata (e.g., sceneId, tokens used)
 * @returns Success status and new balance
 */
export async function deductFunds(
  userId: string,
  amountInCents: number,
  description: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean; newBalance: number; transactionId?: string; error?: string }> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Get current user balance
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true }
      })

      if (!user) {
        throw new Error('User not found')
      }

      const balanceBefore = user.balance

      // Check if user has sufficient balance
      if (balanceBefore < amountInCents) {
        throw new Error('Insufficient balance')
      }

      const balanceAfter = balanceBefore - amountInCents

      // Update user balance
      await tx.user.update({
        where: { id: userId },
        data: { balance: balanceAfter }
      })

      // Create transaction record
      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: 'DEBIT',
          amount: -amountInCents,
          balanceBefore,
          balanceAfter,
          description,
          metadata: metadata || {}
        }
      })

      return { newBalance: balanceAfter, transactionId: transaction.id }
    })

    return {
      success: true,
      newBalance: result.newBalance,
      transactionId: result.transactionId
    }
  } catch (error) {
    console.error('Error deducting funds:', error)
    return {
      success: false,
      newBalance: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Check if user has sufficient balance for an operation
 * @param userId - The user's ID
 * @param requiredAmount - Required amount in cents
 * @returns Whether user has sufficient balance
 */
export async function checkBalance(
  userId: string,
  requiredAmount: number
): Promise<{ sufficient: boolean; currentBalance: number }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { balance: true }
  })

  if (!user) {
    return { sufficient: false, currentBalance: 0 }
  }

  return {
    sufficient: user.balance >= requiredAmount,
    currentBalance: user.balance
  }
}

/**
 * Get user's current balance
 * @param userId - The user's ID
 * @returns Current balance in cents
 */
export async function getUserBalance(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { balance: true }
  })

  return user?.balance ?? 0
}

/**
 * Get transaction history for a user
 * @param userId - The user's ID
 * @param limit - Maximum number of transactions to return
 * @returns Array of transactions
 */
export async function getTransactionHistory(
  userId: string,
  limit: number = 50
) {
  return await prisma.transaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit
  })
}

/**
 * Format cents to dollar string
 * @param cents - Amount in cents
 * @returns Formatted string (e.g., "$1.50")
 */
export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
