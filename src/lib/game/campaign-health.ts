// src/lib/game/campaign-health.ts
// Phase 15.4: Campaign Failure Recovery and Health Monitoring

import { prisma } from '@/lib/prisma'

/**
 * Campaign Health Score
 */
export interface CampaignHealth {
  score: number // 0-100, higher is better
  issues: string[]
  recommendations: string[]
  isHealthy: boolean
  metrics: {
    aiConsistency: number
    playerEngagement: number
    sceneSuccessRate: number
    aiFailureRate: number
  }
}

/**
 * Campaign Health Monitor
 * Tracks campaign health and suggests interventions
 */
export class CampaignHealthMonitor {
  private campaignId: string

  constructor(campaignId: string) {
    this.campaignId = campaignId
  }

  /**
   * Calculate overall campaign health
   */
  async calculateHealth(): Promise<CampaignHealth> {
    const [
      aiConsistency,
      playerEngagement,
      sceneSuccessRate,
      aiFailureRate
    ] = await Promise.all([
      this.checkAIConsistency(),
      this.checkPlayerEngagement(),
      this.checkSceneSuccessRate(),
      this.checkAIFailureRate()
    ])

    // Calculate weighted overall score
    const score = Math.round(
      (aiConsistency * 0.3) +
      (playerEngagement * 0.3) +
      (sceneSuccessRate * 0.25) +
      ((100 - aiFailureRate) * 0.15)
    )

    const issues: string[] = []
    const recommendations: string[] = []

    // Identify issues and recommendations
    if (aiConsistency < 50) {
      issues.push('Low AI consistency - responses may be inconsistent')
      recommendations.push('Consider reviewing AI system prompt and campaign settings')
    }

    if (playerEngagement < 40) {
      issues.push('Low player engagement - players may be losing interest')
      recommendations.push('Introduce new story hooks or dramatic events')
      recommendations.push('Check if pacing is too slow or too fast')
    }

    if (sceneSuccessRate < 50) {
      issues.push('High scene failure rate - technical issues detected')
      recommendations.push('Review AI service health and error logs')
    }

    if (aiFailureRate > 20) {
      issues.push('High AI failure rate - service may be unstable')
      recommendations.push('Consider temporary pause or manual GM intervention')
    }

    const isHealthy = score >= 70 && issues.length === 0

    return {
      score,
      issues,
      recommendations,
      isHealthy,
      metrics: {
        aiConsistency,
        playerEngagement,
        sceneSuccessRate,
        aiFailureRate
      }
    }
  }

  /**
   * Check AI consistency
   * Measures how well AI maintains continuity
   */
  private async checkAIConsistency(): Promise<number> {
    try {
      const worldMeta = await prisma.worldMeta.findUnique({
        where: { campaignId: this.campaignId }
      })

      if (!worldMeta) return 50 // Default neutral score

      const aiMetrics = worldMeta.aiMetrics as any
      if (!aiMetrics) return 50

      // Check validation success rate
      const requestHistory = aiMetrics.requestHistory || []
      if (requestHistory.length < 3) return 75 // Not enough data, assume good

      const recentRequests = requestHistory.slice(-10)
      const successfulValidations = recentRequests.filter((r: any) => r.success).length
      const validationRate = (successfulValidations / recentRequests.length) * 100

      return Math.round(validationRate)
    } catch (error) {
      console.error('Error checking AI consistency:', error)
      return 50
    }
  }

  /**
   * Check player engagement
   * Measures how active players are
   */
  private async checkPlayerEngagement(): Promise<number> {
    try {
      // Get recent scenes
      const recentScenes = await prisma.scene.findMany({
        where: { campaignId: this.campaignId },
        orderBy: { sceneNumber: 'desc' },
        take: 10,
        include: { playerActions: true }
      })

      if (recentScenes.length === 0) return 50

      // Calculate average actions per scene
      const totalActions = recentScenes.reduce((sum, scene) => sum + scene.playerActions.length, 0)
      const avgActionsPerScene = totalActions / recentScenes.length

      // Get campaign members
      const memberCount = await prisma.campaignMembership.count({
        where: { campaignId: this.campaignId }
      })

      // Score based on participation rate
      // Good: avgActionsPerScene close to memberCount
      // Bad: avgActionsPerScene much less than memberCount
      const participationRate = memberCount > 0 ? (avgActionsPerScene / memberCount) * 100 : 0

      return Math.min(Math.round(participationRate), 100)
    } catch (error) {
      console.error('Error checking player engagement:', error)
      return 50
    }
  }

  /**
   * Check scene success rate
   * Measures how many scenes resolve successfully
   */
  private async checkSceneSuccessRate(): Promise<number> {
    try {
      const recentScenes = await prisma.scene.findMany({
        where: { campaignId: this.campaignId },
        orderBy: { sceneNumber: 'desc' },
        take: 20
      })

      if (recentScenes.length === 0) return 100 // No failures yet

      const resolvedScenes = recentScenes.filter(s => s.status === 'RESOLVED').length
      const successRate = (resolvedScenes / recentScenes.length) * 100

      return Math.round(successRate)
    } catch (error) {
      console.error('Error checking scene success rate:', error)
      return 50
    }
  }

  /**
   * Check AI failure rate
   */
  private async checkAIFailureRate(): Promise<number> {
    try {
      const worldMeta = await prisma.worldMeta.findUnique({
        where: { campaignId: this.campaignId }
      })

      if (!worldMeta) return 0

      const aiMetrics = worldMeta.aiMetrics as any
      if (!aiMetrics || aiMetrics.totalRequests === 0) return 0

      const failureRate = (aiMetrics.failedRequests / aiMetrics.totalRequests) * 100
      return Math.round(failureRate)
    } catch (error) {
      console.error('Error checking AI failure rate:', error)
      return 0
    }
  }

  /**
   * Detect if campaign is in an "unwinnable" situation
   * (e.g., all characters dead, impossible scenario)
   */
  async detectUnwinnableScenario(): Promise<{
    isUnwinnable: boolean
    reason?: string
    suggestedAction?: string
  }> {
    try {
      // Check if all characters are "taken out" (harm >= 6)
      const characters = await prisma.character.findMany({
        where: { campaignId: this.campaignId }
      })

      if (characters.length === 0) {
        return {
          isUnwinnable: true,
          reason: 'No characters in campaign',
          suggestedAction: 'Create new characters or end campaign'
        }
      }

      const aliveCharacters = characters.filter(c => {
        const harm = (c as any).harm || 0
        return harm < 6
      })

      if (aliveCharacters.length === 0) {
        return {
          isUnwinnable: true,
          reason: 'All characters are taken out',
          suggestedAction: 'Consider campaign reset or epilogue scene'
        }
      }

      // Check for extremely high threat levels
      const threats = await prisma.clock.findMany({
        where: {
          campaignId: this.campaignId,
          category: 'threat',
          currentTicks: { gte: 0 } // All threat clocks
        }
      })

      const completedThreats = threats.filter(t => t.currentTicks >= t.maxTicks)
      if (completedThreats.length >= 3) {
        return {
          isUnwinnable: false, // Not unwinnable but very dangerous
          reason: 'Multiple threat clocks completed',
          suggestedAction: 'Consider introducing escape route or deus ex machina'
        }
      }

      return { isUnwinnable: false }
    } catch (error) {
      console.error('Error detecting unwinnable scenario:', error)
      return { isUnwinnable: false }
    }
  }

  /**
   * Suggest good stopping points for campaign reset
   */
  async suggestStoppingPoints(): Promise<string[]> {
    const suggestions: string[] = []

    try {
      // Check if recent scene was a major milestone
      const recentScene = await prisma.scene.findFirst({
        where: { campaignId: this.campaignId },
        orderBy: { sceneNumber: 'desc' }
      })

      if (recentScene) {
        // Check for resolution keywords in scene text
        const text = recentScene.sceneResolutionText?.toLowerCase() || ''

        if (text.includes('victory') || text.includes('defeated') || text.includes('triumph')) {
          suggestions.push('Recent victory - good point to end season or take break')
        }

        if (text.includes('escape') || text.includes('safe') || text.includes('haven')) {
          suggestions.push('Characters reached safety - good stopping point')
        }
      }

      // Check scene count
      const sceneCount = await prisma.scene.count({
        where: { campaignId: this.campaignId }
      })

      if (sceneCount >= 50) {
        suggestions.push('Campaign has 50+ scenes - consider wrapping up story arc')
      }

      return suggestions
    } catch (error) {
      console.error('Error suggesting stopping points:', error)
      return []
    }
  }

  /**
   * Store health check results
   */
  async recordHealthCheck(health: CampaignHealth): Promise<void> {
    try {
      const worldMeta = await prisma.worldMeta.findUnique({
        where: { campaignId: this.campaignId }
      })

      if (!worldMeta) return

      const healthHistory = (worldMeta.campaignHealthHistory as any[]) || []

      healthHistory.push({
        timestamp: new Date().toISOString(),
        score: health.score,
        issues: health.issues,
        metrics: health.metrics
      })

      // Keep last 30 health checks
      const recentHistory = healthHistory.slice(-30)

      await prisma.worldMeta.update({
        where: { id: worldMeta.id },
        data: {
          campaignHealthHistory: recentHistory as any,
          lastHealthCheck: new Date(),
          currentHealthScore: health.score
        }
      })
    } catch (error) {
      console.error('Error recording health check:', error)
    }
  }
}

/**
 * Check if campaign needs intervention
 */
export async function checkCampaignNeedsIntervention(campaignId: string): Promise<boolean> {
  const monitor = new CampaignHealthMonitor(campaignId)
  const health = await monitor.calculateHealth()

  return health.score < 50 || health.issues.length >= 3
}
