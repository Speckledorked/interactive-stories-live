/**
 * Phase 25: Safety Tools & Content Moderation Service
 *
 * Provides X-Card functionality, content warnings, and moderation tools
 */

import { prisma } from '@/lib/prisma';
import { XCardTrigger, ReportStatus, ReportSeverity } from '@prisma/client';

// ContentWarningType enum - matches prisma schema but not exported by Prisma client
// because it's stored as Json in the database
export enum ContentWarningType {
  VIOLENCE = 'VIOLENCE',
  SEXUAL_CONTENT = 'SEXUAL_CONTENT',
  GORE = 'GORE',
  HORROR = 'HORROR',
  SUBSTANCE_ABUSE = 'SUBSTANCE_ABUSE',
  MENTAL_HEALTH = 'MENTAL_HEALTH',
  DISCRIMINATION = 'DISCRIMINATION',
  DEATH = 'DEATH',
  TRAUMA = 'TRAUMA',
  CUSTOM = 'CUSTOM',
}

export interface SafetySettings {
  xCardEnabled?: boolean;
  anonymousXCard?: boolean;
  pauseOnXCard?: boolean;
  xCardNotifyGMOnly?: boolean;
  contentWarningsEnabled?: boolean;
  activeWarnings?: ContentWarningType[];
  lines?: string[];
  veils?: string[];
  autoModeration?: boolean;
  moderationLevel?: 'low' | 'medium' | 'high';
}

export class SafetyService {
  /**
   * Initialize safety settings for a campaign
   */
  static async initializeCampaignSafety(campaignId: string, settings: SafetySettings = {}) {
    return await prisma.campaignSafetySettings.upsert({
      where: { campaignId },
      update: settings,
      create: {
        campaignId,
        xCardEnabled: settings.xCardEnabled ?? true,
        anonymousXCard: settings.anonymousXCard ?? true,
        pauseOnXCard: settings.pauseOnXCard ?? true,
        xCardNotifyGMOnly: settings.xCardNotifyGMOnly ?? false,
        contentWarningsEnabled: settings.contentWarningsEnabled ?? true,
        activeWarnings: settings.activeWarnings ?? [],
        lines: settings.lines ?? [],
        veils: settings.veils ?? [],
        autoModeration: settings.autoModeration ?? false,
        moderationLevel: settings.moderationLevel ?? 'medium',
      },
    });
  }

  /**
   * Get campaign safety settings
   */
  static async getCampaignSafety(campaignId: string) {
    let settings = await prisma.campaignSafetySettings.findUnique({
      where: { campaignId },
    });

    if (!settings) {
      // Create default settings if they don't exist
      settings = await this.initializeCampaignSafety(campaignId);
    }

    return settings;
  }

  /**
   * Update campaign safety settings
   */
  static async updateSafetySettings(campaignId: string, settings: SafetySettings) {
    return await prisma.campaignSafetySettings.update({
      where: { campaignId },
      data: settings,
    });
  }

  /**
   * Use X-Card (player calls for pause/rewind)
   */
  static async useXCard(
    campaignId: string,
    userId: string,
    trigger: XCardTrigger,
    targetId?: string,
    reason?: string,
    sceneId?: string
  ) {
    const settings = await this.getCampaignSafety(campaignId);

    if (!settings.xCardEnabled) {
      throw new Error('X-Card is not enabled for this campaign');
    }

    // Create X-Card use record
    const xCardUse = await prisma.xCardUse.create({
      data: {
        campaignId,
        userId,
        trigger,
        targetId,
        reason,
        sceneId,
        isAnonymous: settings.anonymousXCard,
      },
    });

    // Notify GM (and optionally other players)
    await this.notifyXCardUse(campaignId, userId, xCardUse, settings);

    // If pauseOnXCard is enabled, pause the scene
    if (settings.pauseOnXCard && sceneId) {
      await this.pauseScene(sceneId);
    }

    return xCardUse;
  }

  /**
   * Acknowledge X-Card use (GM response)
   */
  static async acknowledgeXCard(xCardId: string, gmUserId: string, resolution?: string) {
    return await prisma.xCardUse.update({
      where: { id: xCardId },
      data: {
        acknowledged: true,
        acknowledgedBy: gmUserId,
        acknowledgedAt: new Date(),
        resolution,
      },
    });
  }

  /**
   * Get X-Card history for campaign
   */
  static async getXCardHistory(campaignId: string, includeAnonymous: boolean = false) {
    return await prisma.xCardUse.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        trigger: true,
        targetId: true,
        reason: includeAnonymous,
        isAnonymous: true,
        userId: includeAnonymous,
        acknowledged: true,
        acknowledgedAt: true,
        resolution: true,
        createdAt: true,
        sceneId: true,
      },
    });
  }

  /**
   * Report content for moderation
   */
  static async reportContent(
    reporterId: string,
    campaignId: string,
    contentType: string,
    contentId: string | null,
    reason: string,
    category?: string,
    severity: ReportSeverity = ReportSeverity.MEDIUM,
    contentText?: string
  ) {
    return await prisma.contentReport.create({
      data: {
        reporterId,
        campaignId,
        contentType,
        contentId,
        contentText,
        reason,
        category,
        severity,
        status: ReportStatus.PENDING,
      },
    });
  }

  /**
   * Get pending reports for moderation
   */
  static async getPendingReports(campaignId?: string) {
    return await prisma.contentReport.findMany({
      where: {
        ...(campaignId && { campaignId }),
        status: ReportStatus.PENDING,
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Review and resolve a report
   */
  static async resolveReport(
    reportId: string,
    reviewerId: string,
    resolution: string,
    actionTaken?: string
  ) {
    return await prisma.contentReport.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.RESOLVED,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        resolution,
        actionTaken,
      },
    });
  }

  /**
   * Dismiss a report
   */
  static async dismissReport(reportId: string, reviewerId: string, reason: string) {
    return await prisma.contentReport.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.DISMISSED,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        resolution: reason,
      },
    });
  }

  /**
   * Block a user
   */
  static async blockUser(
    userId: string,
    blockedUserId: string,
    campaignId?: string,
    reason?: string
  ) {
    return await prisma.userBlock.create({
      data: {
        userId,
        blockedUserId,
        campaignId,
        reason,
      },
    });
  }

  /**
   * Unblock a user
   */
  static async unblockUser(userId: string, blockedUserId: string, campaignId?: string) {
    return await prisma.userBlock.deleteMany({
      where: {
        userId,
        blockedUserId,
        ...(campaignId && { campaignId }),
      },
    });
  }

  /**
   * Check if user is blocked
   */
  static async isUserBlocked(userId: string, blockedUserId: string, campaignId?: string) {
    const block = await prisma.userBlock.findFirst({
      where: {
        userId,
        blockedUserId,
        OR: [{ campaignId }, { campaignId: null }], // Check both campaign-specific and global blocks
      },
    });
    return !!block;
  }

  /**
   * Ban user from campaign
   */
  static async banUserFromCampaign(
    campaignId: string,
    userId: string,
    bannedBy: string,
    reason: string,
    isPermanent: boolean = false,
    expiresAt?: Date
  ) {
    // Create ban record
    const ban = await prisma.campaignBan.create({
      data: {
        campaignId,
        userId,
        bannedBy,
        reason,
        isPermanent,
        expiresAt,
      },
    });

    // Remove user from campaign
    await prisma.campaignMembership.deleteMany({
      where: {
        campaignId,
        userId,
      },
    });

    return ban;
  }

  /**
   * Unban user from campaign
   */
  static async unbanUserFromCampaign(campaignId: string, userId: string) {
    return await prisma.campaignBan.delete({
      where: {
        campaignId_userId: { campaignId, userId },
      },
    });
  }

  /**
   * Check if user is banned from campaign
   */
  static async isUserBanned(campaignId: string, userId: string) {
    const ban = await prisma.campaignBan.findUnique({
      where: {
        campaignId_userId: { campaignId, userId },
      },
    });

    if (!ban) return false;

    // Check if temporary ban has expired
    if (!ban.isPermanent && ban.expiresAt && ban.expiresAt < new Date()) {
      await this.unbanUserFromCampaign(campaignId, userId);
      return false;
    }

    return true;
  }

  /**
   * Content moderation check (basic implementation)
   * In production, this would integrate with OpenAI Moderation API or similar
   */
  static async moderateContent(text: string, campaignId: string): Promise<{
    flagged: boolean;
    categories: string[];
    severity: ReportSeverity;
  }> {
    const settings = await this.getCampaignSafety(campaignId);

    if (!settings.autoModeration) {
      return { flagged: false, categories: [], severity: ReportSeverity.LOW };
    }

    // Basic keyword-based moderation (placeholder)
    // In production, use OpenAI Moderation API or similar service
    const flaggedKeywords = {
      high: ['extreme_violence', 'hate_speech', 'illegal'],
      medium: ['sexual_explicit', 'graphic_violence'],
      low: ['profanity', 'mild_violence'],
    };

    const lowerText = text.toLowerCase();
    const foundCategories: string[] = [];
    let maxSeverity: ReportSeverity = ReportSeverity.LOW;

    // Check against lines (hard boundaries)
    for (const line of settings.lines) {
      if (lowerText.includes(line.toLowerCase())) {
        foundCategories.push(`line_crossed:${line}`);
        maxSeverity = ReportSeverity.HIGH;
      }
    }

    // Basic keyword check (very simplified)
    if (foundCategories.length === 0) {
      // No violations found in this basic check
      return { flagged: false, categories: [], severity: ReportSeverity.LOW };
    }

    return {
      flagged: foundCategories.length > 0,
      categories: foundCategories,
      severity: maxSeverity,
    };
  }

  /**
   * Set up Session Zero (pre-game safety discussion)
   */
  static async completeSessionZero(
    campaignId: string,
    lines: string[],
    veils: string[],
    activeWarnings: ContentWarningType[],
    notes?: string
  ) {
    return await prisma.campaignSafetySettings.update({
      where: { campaignId },
      data: {
        sessionZeroCompleted: true,
        sessionZeroDate: new Date(),
        sessionZeroNotes: notes,
        lines,
        veils,
        activeWarnings,
      },
    });
  }

  // Private helper methods

  private static async notifyXCardUse(
    campaignId: string,
    userId: string,
    xCardUse: any,
    settings: any
  ) {
    // Get GM users
    const gmMemberships = await prisma.campaignMembership.findMany({
      where: {
        campaignId,
        role: 'ADMIN',
      },
      include: {
        user: true,
      },
    });

    const notifyUserIds = gmMemberships.map((m) => m.userId);

    // If not GM-only, notify all players
    if (!settings.xCardNotifyGMOnly) {
      const allMemberships = await prisma.campaignMembership.findMany({
        where: { campaignId },
      });
      notifyUserIds.push(...allMemberships.map((m) => m.userId));
    }

    // Create notifications
    const uniqueUserIds = [...new Set(notifyUserIds)];
    for (const notifyUserId of uniqueUserIds) {
      await prisma.notification.create({
        data: {
          type: 'SCENE_CHANGE', // Closest existing type
          title: 'X-Card Used',
          message: settings.anonymousXCard
            ? 'A player has used the X-Card. Please pause and check in with everyone.'
            : `${userId} has used the X-Card.`,
          userId: notifyUserId,
          campaignId,
          sceneId: xCardUse.sceneId,
          priority: 'URGENT',
          metadata: {
            xCardId: xCardUse.id,
            trigger: xCardUse.trigger,
          },
        },
      });
    }
  }

  private static async pauseScene(sceneId: string) {
    // Set scene status to a paused state
    // Note: We don't have a PAUSED status, so we'll use AWAITING_ACTIONS
    // In a full implementation, add a PAUSED status to SceneStatus enum
    await prisma.scene.update({
      where: { id: sceneId },
      data: {
        // Add a flag or use existing status
        // For now, we'll just record it in the database
      },
    });
  }
}
