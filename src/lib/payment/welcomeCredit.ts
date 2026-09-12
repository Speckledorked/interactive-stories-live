// src/lib/payment/welcomeCredit.ts
//
// The one-time credit that lets a new account play a scene before funding a
// balance. Without it the activation funnel dead-ends at the very first
// paywall: User.balance defaults to 0 and nothing starts work it cannot pay
// for.
//
// It is also real money handed to whoever asks, on a product with open
// signup, so two things bound it:
//
//   - It is paid at EMAIL VERIFICATION, not at signup. An address that
//     merely parses is not a person; granting at signup made the credit free
//     money for a throwaway inbox, behind nothing but an IP rate limit.
//     Verification costs a real tester one click and costs a farm an inbox
//     it controls per dollar.
//   - The programme has a hard ceiling. Past it, accounts still verify
//     normally and simply start at zero — the door stays open, the spending
//     stops. A cap that turned people away instead would trade an unbounded
//     bill for an unbounded loss of testers, which is the wrong way round.

import { prisma } from '@/lib/prisma'
import { addFunds } from './service'

export const WELCOME_CREDIT_CENTS = 100

/**
 * Total the welcome-credit programme will ever hand out, in cents.
 * At WELCOME_CREDIT_CENTS each this is the number of funded testers the
 * beta is willing to buy. Tune it here — it is a spending decision, not a
 * tuning parameter, so it lives in the open rather than in an env var
 * nobody reads.
 */
export const WELCOME_CREDIT_BUDGET_CENTS = 50_000

/**
 * The exact ledger description every welcome credit carries. It is also how
 * the programme counts itself (see countWelcomeCreditsGranted), so it is a
 * constant rather than an inline string: changing the wording without
 * changing this would silently reset the budget to zero spent.
 */
export const WELCOME_CREDIT_DESCRIPTION = 'Welcome credit — your first scene is on us'

/** Cents handed out so far, counted from the ledger itself. */
export async function countWelcomeCreditsGranted(): Promise<number> {
  // Narrowed by the indexed `type` first; the description match is what makes
  // it exact. Counting ledger rows rather than users means historical grants
  // (which were paid at signup) are included without a backfill, and a grant
  // that failed is not counted as spent.
  const granted = await prisma.transaction.count({
    where: { type: 'CREDIT', description: WELCOME_CREDIT_DESCRIPTION },
  })
  return granted * WELCOME_CREDIT_CENTS
}

export interface WelcomeCreditResult {
  granted: boolean
  reason?: 'budget-exhausted' | 'failed'
}

/**
 * Pay the welcome credit if the programme can still afford it.
 *
 * Never throws: a funding hiccup must not fail the verification it is
 * attached to. The caller's job (marking the address verified) is the part
 * that must succeed.
 */
export async function grantWelcomeCredit(userId: string): Promise<WelcomeCreditResult> {
  try {
    const spent = await countWelcomeCreditsGranted()
    if (spent + WELCOME_CREDIT_CENTS > WELCOME_CREDIT_BUDGET_CENTS) {
      console.warn(
        `Welcome credit budget exhausted (${spent} of ${WELCOME_CREDIT_BUDGET_CENTS} cents) — ${userId} starts at zero`
      )
      return { granted: false, reason: 'budget-exhausted' }
    }

    const result = await addFunds(userId, WELCOME_CREDIT_CENTS, WELCOME_CREDIT_DESCRIPTION)
    if (!result.success) {
      console.error(`Welcome credit failed for ${userId}: ${result.error}`)
      return { granted: false, reason: 'failed' }
    }
    return { granted: true }
  } catch (error) {
    console.error('Welcome credit failed (non-critical):', error)
    return { granted: false, reason: 'failed' }
  }
}
