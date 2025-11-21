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
}

/**
 * AI Pricing (GPT-4 pricing as of implementation)
 * Update these values based on actual provider pricing
 */
const AI_PRICING = {
  'gpt-4-turbo-preview': {
    inputTokenPrice: 0.01 / 1000,  // $0.01 per 1K input tokens
    outputTokenPrice: 0.03 / 1000   // $0.03 per 1K output tokens
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

/**
 * AI Cost Tracker
 * Tracks token usage and costs per campaign
 */
export class AICostTracker {
  private campaignId: string
  private model: keyof typeof AI_PRICING

  constructor(campaignId: string, model: keyof typeof AI_PRICING = 'gpt-4-turbo-preview') {
    this.campaignId = campaignId
    this.model = model
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
  }): Promise<void> {
    const pricing = AI_PRICING[this.model]
    const cost = (params.inputTokens * pricing.inputTokenPrice) +
                 (params.outputTokens * pricing.outputTokenPrice)

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

        // Track per-scene costs
        requestHistory: [
          ...(currentMetrics.requestHistory || []).slice(-50), // Keep last 50 requests
          {
            timestamp: new Date().toISOString(),
            sceneId: params.sceneId,
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
      console.log(`💰 AI Cost Tracking:`)
      console.log(`   Tokens: ${params.inputTokens} in + ${params.outputTokens} out`)
      console.log(`   Cost: $${cost.toFixed(4)}`)
      console.log(`   Total campaign cost: $${updatedMetrics.totalCost.toFixed(4)}`)
      console.log(`   Cache hit: ${params.cacheHit ? 'YES' : 'NO'}`)

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
        failedRequests: metrics.failedRequests || 0
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
    const pricing = AI_PRICING[this.model]
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
      requestHistory: [],
      lastUpdated: new Date().toISOString()
    }
  }
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
