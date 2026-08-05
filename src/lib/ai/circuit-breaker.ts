// src/lib/ai/circuit-breaker.ts
// Phase 15.3: Circuit Breaker System for AI failures

import { prisma } from '@/lib/prisma'

/**
 * Circuit Breaker States
 */
export enum CircuitState {
  CLOSED = 'CLOSED',       // Normal operation
  OPEN = 'OPEN',           // Too many failures, blocking requests
  HALF_OPEN = 'HALF_OPEN'  // Testing if service recovered
}

/**
 * Circuit Breaker Configuration
 */
interface CircuitBreakerConfig {
  failureThreshold: number      // Number of consecutive failures before opening
  resetTimeout: number           // Time in ms before attempting recovery
  halfOpenAttempts: number       // Number of test attempts in half-open state
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  resetTimeout: 60000, // 1 minute
  halfOpenAttempts: 1
}

/**
 * Circuit Breaker for AI GM calls
 * Prevents cascading failures and provides graceful degradation
 */
export class AICircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED
  private failureCount: number = 0
  private lastFailureTime: number | null = null
  private campaignId: string
  private config: CircuitBreakerConfig

  constructor(campaignId: string, config?: Partial<CircuitBreakerConfig>) {
    this.campaignId = campaignId
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Check if we should allow the AI call
   */
  canAttempt(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true
    }

    if (this.state === CircuitState.OPEN) {
      // Check if enough time has passed to try again
      if (this.lastFailureTime && Date.now() - this.lastFailureTime >= this.config.resetTimeout) {
        this.state = CircuitState.HALF_OPEN
        console.log(`🔄 Circuit breaker moving to HALF_OPEN for campaign ${this.campaignId}`)
        return true
      }
      return false
    }

    // HALF_OPEN state - allow one attempt
    return true
  }

  /**
   * Record a successful AI call
   */
  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      console.log(`✅ Circuit breaker CLOSED for campaign ${this.campaignId} - service recovered`)
    }

    this.failureCount = 0
    this.state = CircuitState.CLOSED
    this.lastFailureTime = null
  }

  /**
   * Record a failed AI call
   */
  recordFailure(error: Error): void {
    this.failureCount++
    this.lastFailureTime = Date.now()

    console.error(`❌ Circuit breaker failure ${this.failureCount}/${this.config.failureThreshold} for campaign ${this.campaignId}:`, error.message)

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN
      console.error(`🚫 Circuit breaker OPEN for campaign ${this.campaignId} - too many failures`)

      // Log to database for campaign health monitoring
      this.logCircuitBreakerEvent('OPENED').catch(error => {
        console.error(`⚠️ Circuit breaker persistence failed for campaign ${this.campaignId} (event=OPENED) — aiHealth record was not updated:`, error)
      })
    }
  }

  /**
   * Restore state persisted in WorldMeta.aiHealth from a previous process —
   * used on cold start so a campaign that tripped the breaker before a
   * serverless restart doesn't silently reopen at CLOSED.
   */
  hydrate(failureCount: number, lastFailureTime: number | null): void {
    this.failureCount = failureCount
    this.lastFailureTime = lastFailureTime
    this.state = failureCount >= this.config.failureThreshold ? CircuitState.OPEN : CircuitState.CLOSED
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state
  }

  /**
   * Get failure count
   */
  getFailureCount(): number {
    return this.failureCount
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED
    this.failureCount = 0
    this.lastFailureTime = null
    console.log(`🔄 Circuit breaker manually RESET for campaign ${this.campaignId}`)
  }

  /**
   * Log circuit breaker events to database for monitoring
   */
  private async logCircuitBreakerEvent(event: 'OPENED' | 'CLOSED' | 'HALF_OPEN'): Promise<void> {
    try {
      // Store in campaign metadata for health monitoring
      const worldMeta = await prisma.worldMeta.findUnique({
        where: { campaignId: this.campaignId }
      })

      if (worldMeta) {
        const aiHealth = (worldMeta.aiHealth as any) || {
          circuitBreakerEvents: [],
          consecutiveFailures: 0,
          lastFailureTimestamp: null
        }

        aiHealth.circuitBreakerEvents.push({
          event,
          timestamp: new Date().toISOString(),
          failureCount: this.failureCount
        })

        // Unbounded growth otherwise — a campaign with many flaky AI calls
        // would bloat this JSON column forever. Keep only recent history.
        aiHealth.circuitBreakerEvents = aiHealth.circuitBreakerEvents.slice(-50)

        aiHealth.consecutiveFailures = this.failureCount
        aiHealth.lastFailureTimestamp = this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null

        await prisma.worldMeta.update({
          where: { id: worldMeta.id },
          data: {
            aiHealth: aiHealth as any
          }
        })
      }
    } catch (error) {
      console.error(`Failed to log circuit breaker event (campaign=${this.campaignId}, event=${event}):`, error)
    }
  }
}

/**
 * Global circuit breaker manager
 * Maintains one circuit breaker per campaign
 */
class CircuitBreakerManager {
  private breakers: Map<string, AICircuitBreaker> = new Map()
  // Campaigns whose breaker has already been hydrated from the DB in this
  // process — hydration only needs to happen once per campaign per process,
  // not on every call.
  private hydratedCampaigns: Set<string> = new Set()

  getBreaker(campaignId: string): AICircuitBreaker {
    if (!this.breakers.has(campaignId)) {
      this.breakers.set(campaignId, new AICircuitBreaker(campaignId))
    }
    return this.breakers.get(campaignId)!
  }

  /**
   * Same as getBreaker, but on first access per campaign in this process
   * also restores state from WorldMeta.aiHealth — without this, a breaker
   * that was OPEN before a serverless cold start comes back CLOSED and the
   * protection it was providing is lost until 3 more failures happen.
   */
  async ensureHydrated(campaignId: string): Promise<AICircuitBreaker> {
    const breaker = this.getBreaker(campaignId)
    if (this.hydratedCampaigns.has(campaignId)) {
      return breaker
    }
    this.hydratedCampaigns.add(campaignId)

    try {
      const worldMeta = await prisma.worldMeta.findUnique({ where: { campaignId } })
      const aiHealth = worldMeta?.aiHealth as
        | { consecutiveFailures?: number; lastFailureTimestamp?: string | null }
        | null
        | undefined

      if (aiHealth?.consecutiveFailures) {
        const lastFailureTime = aiHealth.lastFailureTimestamp
          ? new Date(aiHealth.lastFailureTimestamp).getTime()
          : null
        breaker.hydrate(aiHealth.consecutiveFailures, lastFailureTime)
      }
    } catch (error) {
      console.warn(`Circuit breaker hydration failed for campaign ${campaignId} — starting CLOSED:`, error)
    }

    return breaker
  }

  resetBreaker(campaignId: string): void {
    const breaker = this.breakers.get(campaignId)
    if (breaker) {
      breaker.reset()
    }
  }

  getAllStates(): Map<string, CircuitState> {
    const states = new Map<string, CircuitState>()
    for (const [campaignId, breaker] of this.breakers.entries()) {
      states.set(campaignId, breaker.getState())
    }
    return states
  }
}

// Export singleton instance
export const circuitBreakerManager = new CircuitBreakerManager()
