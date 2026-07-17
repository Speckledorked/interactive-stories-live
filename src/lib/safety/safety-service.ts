/**
 * Phase 25: Safety Tools & Content Moderation Service
 *
 * Provides X-Card functionality, content warnings, and moderation tools
 */

import { prisma } from '@/lib/prisma';
import { XCardTrigger, ReportStatus, ReportSeverity } from '@prisma/client';
import PusherServer from '@/lib/realtime/pusher-server';

export interface SafetySettings {
  xCardEnabled?: boolean;
  anonymousXCard?: boolean;
  pauseOnXCard?: boolean;
  xCardNotifyGMOnly?: boolean;
  lines?: string[];
  veils?: string[];
}

export class SafetyService {
  /**
   * Create or update a campaign's safety settings. Upserts, so this is
   * safe to call whether or not a settings row exists yet for this campaign.
   */
  static async updateSafetySettings(campaignId: string, settings: SafetySettings = {}) {
    return await prisma.campaignSafetySettings.upsert({
      where: { campaignId },
      update: settings,
      create: {
        campaignId,
        xCardEnabled: settings.xCardEnabled ?? true,
        anonymousXCard: settings.anonymousXCard ?? true,
        pauseOnXCard: settings.pauseOnXCard ?? true,
        xCardNotifyGMOnly: settings.xCardNotifyGMOnly ?? false,
        lines: settings.lines ?? [],
        veils: settings.veils ?? [],
      },
    });
  }

  /**
   * Get campaign safety settings, creating the default row on first read.
   */
  static async getCampaignSafety(campaignId: string) {
    const settings = await prisma.campaignSafetySettings.findUnique({
      where: { campaignId },
    });

    return settings ?? (await this.updateSafetySettings(campaignId));
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
      await this.pauseScene(sceneId, `X-Card called (${trigger})`);
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
   * Get reports for a campaign, optionally filtered by status. Unlike
   * getPendingReports, this also surfaces resolved/dismissed reports so an
   * admin panel can show a full moderation history, not just the queue.
   */
  static async getReports(campaignId: string, status?: ReportStatus) {
    return await prisma.contentReport.findMany({
      where: {
        campaignId,
        ...(status && { status }),
      },
      orderBy: [{ status: 'asc' }, { severity: 'desc' }, { createdAt: 'desc' }],
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
          type: 'SAFETY_ALERT',
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

  // Sets Scene.isPaused (see schema comment) and broadcasts it so every
  // connected client reacts immediately — the story page blocks new action
  // submissions and resolution while paused (see scene/route.ts,
  // sceneResolver.ts resolveScene) regardless of which of these two entry
  // points set the flag.
  private static async pauseScene(sceneId: string, reason: string) {
    const scene = await prisma.scene.update({
      where: { id: sceneId },
      data: {
        isPaused: true,
        pausedAt: new Date(),
        pausedReason: reason,
      },
    });

    try {
      const pusher = PusherServer();
      if (pusher) {
        await pusher.trigger(`campaign-${scene.campaignId}`, 'scene:paused', {
          sceneId,
          campaignId: scene.campaignId,
          reason,
        });
      }
    } catch (pusherError) {
      console.error('⚠️ Failed to broadcast Pusher scene:paused event:', pusherError);
    }
  }

  /**
   * Resume a scene paused by an X-Card (GM/admin action, see
   * scenes/[sceneId]/resume route).
   */
  static async resumeScene(sceneId: string) {
    const scene = await prisma.scene.update({
      where: { id: sceneId },
      data: {
        isPaused: false,
        pausedAt: null,
        pausedReason: null,
      },
    });

    try {
      const pusher = PusherServer();
      if (pusher) {
        await pusher.trigger(`campaign-${scene.campaignId}`, 'scene:resumed', {
          sceneId,
          campaignId: scene.campaignId,
        });
      }
    } catch (pusherError) {
      console.error('⚠️ Failed to broadcast Pusher scene:resumed event:', pusherError);
    }

    return scene;
  }
}
