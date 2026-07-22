// src/lib/ai/cost-tracker.ts
// Phase 15.5.1: AI Cost Optimization and Tracking

import { prisma } from '@/lib/prisma'

/**
 * AI Usage Metrics
 */
export interface AIUsageMetrics {
  tokensUsed: number
  costPerCampaign: number
  averageResponseTime: number
  cacheHitRate: number
  totalRequests: number
  failedRequests: number
  costByType: Record<string, { cost: number; requests: number }>
}

/**
 * AI Pricing. Update whenever the models in src/lib/ai/models.ts change
 * generation — this table needs to match whatever is actually being
 * called, or the numbers here are fiction. Verified against
 * https://developers.openai.com/api/docs/pricing on 2026-07-08.
 *
 * Two different quoting conventions are mixed in here on purpose — each
 * entry's price is per the unit its own pricing-page number was actually
 * quoted in, not a uniform "per 1K" that got applied to everything:
 *   - gpt-5.4 / gpt-5.4-mini / gpt-4.1 / gpt-4.1-mini: OpenAI quotes these
 *     per MILLION tokens (e.g. gpt-4.1 is $2.00 in / $8.00 out per 1M —
 *     divide by 1_000_000 to get $/token). Dividing the same numerators by
 *     1_000 instead — as this table used to, uniformly — silently overbills
 *     every call these models make by 1000x, since they're the ones
 *     src/lib/ai/models.ts actually routes traffic to.
 *   - The legacy entries below (gpt-4-turbo-preview, gpt-4, gpt-3.5-turbo,
 *     text-embedding-ada-002) are genuinely quoted per 1K tokens on
 *     OpenAI's historical pricing pages — divide by 1_000, correctly, as
 *     before.
 */
const AI_PRICING: Record<string, { inputTokenPrice: number; outputTokenPrice: number }> = {
  // Current generation (see src/lib/ai/models.ts) — priced per 1M tokens.
  'gpt-5.4': {
    inputTokenPrice: 2.5 / 1_000_000,
    outputTokenPrice: 15.0 / 1_000_000
  },
  'gpt-5.4-mini': {
    inputTokenPrice: 0.75 / 1_000_000,
    outputTokenPrice: 4.5 / 1_000_000
  },
  // Embeddings have no output tokens — outputTokenPrice stays 0 and callers
  // always pass outputTokens: 0. Priced per 1K tokens.
  'text-embedding-ada-002': {
    inputTokenPrice: 0.0001 / 1000,
    outputTokenPrice: 0
  },

  // Legacy — kept so historical requestHistory entries recorded under these
  // model names still resolve to a real price instead of falling through to
  // the unknown-model fallback below. gpt-4.1/gpt-4.1-mini priced per 1M
  // tokens; gpt-4-turbo-preview/gpt-4/gpt-3.5-turbo priced per 1K tokens.
  'gpt-4.1': {
    inputTokenPrice: 2.0 / 1_000_000,
    outputTokenPrice: 8.0 / 1_000_000
  },
  'gpt-4.1-mini': {
    inputTokenPrice: 0.4 / 1_000_000,
    outputTokenPrice: 1.6 / 1_000_000
  },
  'gpt-4-turbo-preview': {
    inputTokenPrice: 0.01 / 1000,
    outputTokenPrice: 0.03 / 1000
  },
  'gpt-4': {
    inputTokenPrice: 0.03 / 1000,
    outputTokenPrice: 0.06 / 1000
  },
  'gpt-3.5-turbo': {
    inputTokenPrice: 0.0015 / 1000,
    outputTokenPrice: 0.002 / 1000
  }
}

// Used when a model string isn't in the table above (e.g. pricing wasn't
// updated after a model swap) — better to record an approximate cost with a
// loud warning than to silently record $0 and hide a real expense.
const FALLBACK_PRICING = AI_PRICING['gpt-5.4']

/**
 * AI Cost Tracker
 * Tracks token usage and costs per campaign
 */
export class AICostTracker {
  private campaignId: string
  private model: string

  constructor(campaignId: string, model: string = 'gpt-5.4') {
    this.campaignId = campaignId
    this.model = model
  }

  private getPricing() {
    const pricing = AI_PRICING[this.model]
    if (!pricing) {
      console.warn(`⚠️ No pricing entry for model "${this.model}" — using gpt-5.4 pricing as an approximation. Update AI_PRICING in cost-tracker.ts.`)
      return FALLBACK_PRICING
    }
    return pricing
  }

  /**
   * Record an AI request and calculate cost
   */
  async recordRequest(params: {
    inputTokens: number
    outputTokens: number
    responseTimeMs: number
    success: boolean
    cacheHit?: boolean
    sceneId?: string
    /** Which call this was — "scene_resolution", "map_generation", "consequence_extraction", etc. Powers the per-type cost breakdown. */
    requestType?: string
  }): Promise<void> {
    const pricing = this.getPricing()
    const cost = (params.inputTokens * pricing.inputTokenPrice) +
                 (params.outputTokens * pricing.outputTokenPrice)
    const requestType = params.requestType || 'unknown'

    try {
      // Get or create AI metrics for campaign
      const worldMeta = await prisma.worldMeta.findUnique({
        where: { campaignId: this.campaignId }
      })

      if (!worldMeta) {
        console.warn('WorldMeta not found for campaign:', this.campaignId)
        return
      }

      const currentMetrics = (worldMeta.aiMetrics as any) || this.createEmptyMetrics()
      const currentCostByType = currentMetrics.costByType || {}
      const existingTypeEntry = currentCostByType[requestType] || { cost: 0, requests: 0 }

      // Update metrics
      const updatedMetrics = {
        tokensUsed: currentMetrics.tokensUsed + params.inputTokens + params.outputTokens,
        totalCost: (currentMetrics.totalCost || 0) + cost,
        totalRequests: currentMetrics.totalRequests + 1,
        failedRequests: currentMetrics.failedRequests + (params.success ? 0 : 1),

        // Calculate running average for response time
        averageResponseTime: (
          (currentMetrics.averageResponseTime * currentMetrics.totalRequests) +
          params.responseTimeMs
        ) / (currentMetrics.totalRequests + 1),

        // Track cache hits
        cacheHits: currentMetrics.cacheHits + (params.cacheHit ? 1 : 0),
        cacheHitRate: params.cacheHit
          ? ((currentMetrics.cacheHits + 1) / (currentMetrics.totalRequests + 1))
          : (currentMetrics.cacheHits / (currentMetrics.totalRequests + 1)),

        // Cost broken down by which call made it — this is what actually
        // answers "how much is each part costing", not just one lump sum.
        costByType: {
          ...currentCostByType,
          [requestType]: {
            cost: existingTypeEntry.cost + cost,
            requests: existingTypeEntry.requests + 1
          }
        },

        // Track per-scene costs
        requestHistory: [
          ...(currentMetrics.requestHistory || []).slice(-50), // Keep last 50 requests
          {
            timestamp: new Date().toISOString(),
            sceneId: params.sceneId,
            requestType,
            model: this.model,
            inputTokens: params.inputTokens,
            outputTokens: params.outputTokens,
            cost,
            responseTimeMs: params.responseTimeMs,
            success: params.success,
            cacheHit: params.cacheHit || false
          }
        ],

        lastUpdated: new Date().toISOString()
      }

      // Update database
      await prisma.worldMeta.update({
        where: { id: worldMeta.id },
        data: {
          aiMetrics: updatedMetrics as any
        }
      })

      // Log cost information
      console.log(`💰 AI Cost Tracking [${requestType}, ${this.model}]: $${cost.toFixed(5)} (${params.inputTokens} in + ${params.outputTokens} out) — campaign total $${updatedMetrics.totalCost.toFixed(4)}`)

      // Durable, per-request, queryable-by-scene — what metered scene
      // billing sums (resolutionBilling.ts). The aiMetrics update above is
      // a rolling summary for the admin dashboard and isn't reliable for
      // billing: requestHistory is capped at 50 entries shared across the
      // whole campaign, so a busy campaign can evict a scene's own rows
      // before it ends.
      await prisma.aICostEntry.create({
        data: {
          campaignId: this.campaignId,
          sceneId: params.sceneId,
          requestType,
          model: this.model,
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
          costMicros: Math.round(cost * 1_000_000),
        },
      }).catch(err => console.error('Failed to record AICostEntry:', err))

    } catch (error) {
      console.error('Failed to record AI cost metrics:', error)
    }
  }

  /**
   * Get current metrics for campaign
   */
  async getMetrics(): Promise<AIUsageMetrics | null> {
    try {
      const worldMeta = await prisma.worldMeta.findUnique({
        where: { campaignId: this.campaignId }
      })

      if (!worldMeta || !worldMeta.aiMetrics) {
        return null
      }

      const metrics = worldMeta.aiMetrics as any

      return {
        tokensUsed: metrics.tokensUsed || 0,
        costPerCampaign: metrics.totalCost || 0,
        averageResponseTime: metrics.averageResponseTime || 0,
        cacheHitRate: metrics.cacheHitRate || 0,
        totalRequests: metrics.totalRequests || 0,
        failedRequests: metrics.failedRequests || 0,
        costByType: metrics.costByType || {}
      }
    } catch (error) {
      console.error('Failed to get AI metrics:', error)
      return null
    }
  }

  /**
   * Check if campaign is approaching budget limits
   */
  async checkBudgetAlert(budgetLimit?: number): Promise<{
    withinBudget: boolean
    percentUsed: number
    totalCost: number
  }> {
    const metrics = await this.getMetrics()

    if (!metrics || !budgetLimit) {
      return { withinBudget: true, percentUsed: 0, totalCost: 0 }
    }

    const percentUsed = (metrics.costPerCampaign / budgetLimit) * 100
    const withinBudget = metrics.costPerCampaign < budgetLimit

    if (!withinBudget) {
      console.warn(`⚠️ Campaign ${this.campaignId} has exceeded budget!`)
      console.warn(`   Budget: $${budgetLimit}`)
      console.warn(`   Used: $${metrics.costPerCampaign.toFixed(4)} (${percentUsed.toFixed(1)}%)`)
    }

    return {
      withinBudget,
      percentUsed,
      totalCost: metrics.costPerCampaign
    }
  }

  /**
   * Estimate cost for a request before making it
   */
  estimateCost(estimatedInputTokens: number, estimatedOutputTokens: number): number {
    const pricing = this.getPricing()
    return (estimatedInputTokens * pricing.inputTokenPrice) +
           (estimatedOutputTokens * pricing.outputTokenPrice)
  }

  /**
   * Get cost statistics for all campaigns (admin view)
   */
  static async getGlobalStatistics(): Promise<{
    totalCost: number
    totalTokens: number
    totalRequests: number
    averageCostPerCampaign: number
    averageCostPerScene: number
  }> {
    try {
      const allWorldMeta = await prisma.worldMeta.findMany({
        select: { aiMetrics: true }
      })

      let totalCost = 0
      let totalTokens = 0
      let totalRequests = 0
      let campaignCount = 0

      for (const meta of allWorldMeta) {
        if (meta.aiMetrics) {
          const metrics = meta.aiMetrics as any
          totalCost += metrics.totalCost || 0
          totalTokens += metrics.tokensUsed || 0
          totalRequests += metrics.totalRequests || 0
          campaignCount++
        }
      }

      return {
        totalCost,
        totalTokens,
        totalRequests,
        averageCostPerCampaign: campaignCount > 0 ? totalCost / campaignCount : 0,
        averageCostPerScene: totalRequests > 0 ? totalCost / totalRequests : 0
      }
    } catch (error) {
      console.error('Failed to get global AI statistics:', error)
      return {
        totalCost: 0,
        totalTokens: 0,
        totalRequests: 0,
        averageCostPerCampaign: 0,
        averageCostPerScene: 0
      }
    }
  }

  /**
   * Create empty metrics object
   */
  private createEmptyMetrics() {
    return {
      tokensUsed: 0,
      totalCost: 0,
      totalRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      cacheHits: 0,
      cacheHitRate: 0,
      costByType: {},
      requestHistory: [],
      lastUpdated: new Date().toISOString()
    }
  }
}

/**
 * Convenience wrapper around `new AICostTracker(campaignId, model).recordRequest(...)`
 * for call sites that just need to log one request and move on — every AI
 * call site outside client.ts's callAIGM (which already manages its own
 * tracker instance for cache-hit/failure paths) should use this instead of
 * silently going untracked.
 */
export async function recordAICost(params: {
  campaignId: string
  model: string
  requestType: string
  inputTokens: number
  outputTokens: number
  responseTimeMs: number
  success: boolean
  sceneId?: string
}): Promise<void> {
  const tracker = new AICostTracker(params.campaignId, params.model)
  await tracker.recordRequest({
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    responseTimeMs: params.responseTimeMs,
    success: params.success,
    sceneId: params.sceneId,
    requestType: params.requestType
  })
}

/**
 * Helper to count tokens (rough approximation)
 * For production, use tiktoken or similar library
 */
export function estimateTokenCount(text: string): number {
  // Rough estimate: ~4 characters per token for English text
  // This is a simplification - use tiktoken for accurate counting
  return Math.ceil(text.length / 4)
}
