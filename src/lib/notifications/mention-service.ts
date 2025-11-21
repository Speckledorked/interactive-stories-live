// src/lib/notifications/mention-service.ts

import { prisma } from '@/lib/prisma';
import { NotificationService } from './notification-service';

export interface MentionResult {
  mentionedUserIds: string[];
  processedContent: string;
  mentions: Array<{
    userId: string;
    username: string;
    displayName: string;
  }>;
}

export class MentionService {

  // Parse mentions from text content
  static async parseMentions(content: string, campaignId: string): Promise<MentionResult> {
    // Find all @mentions in the text
    const mentionRegex = /@(\w+)/g;
    const mentionMatches = Array.from(content.matchAll(mentionRegex));

    if (mentionMatches.length === 0) {
      return {
        mentionedUserIds: [],
        processedContent: content,
        mentions: []
      };
    }

    // Get campaign members for matching
    const campaignMembers = await prisma.campaignMembership.findMany({
      where: { campaignId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true
          }
        }
      }
    });

    const mentions: MentionResult['mentions'] = [];
    const mentionedUserIds: string[] = [];
    let processedContent = content;

    // Process each mention
    for (const match of mentionMatches) {
      const mentionedUsername = match[1].toLowerCase();
      const fullMatch = match[0]; // @username

      // Try to find user by name or email
      const member = campaignMembers.find(m => {
        const userName = (m.user.name || '').toLowerCase();
        const userEmail = m.user.email.toLowerCase();
        const emailUsername = userEmail.split('@')[0].toLowerCase();

        return userName === mentionedUsername || 
               emailUsername === mentionedUsername ||
               userEmail === mentionedUsername;
      });

      if (member) {
        mentions.push({
          userId: member.user.id,
          username: mentionedUsername,
          displayName: member.user.name || member.user.email
        });

        if (!mentionedUserIds.includes(member.user.id)) {
          mentionedUserIds.push(member.user.id);
        }

        // Replace mention with styled version
        processedContent = processedContent.replace(
          fullMatch,
          `<span class="mention" data-user-id="${member.user.id}">@${member.user.name || mentionedUsername}</span>`
        );
      }
    }

    return {
      mentionedUserIds,
      processedContent,
      mentions
    };
  }

  // Process mentions in a message and send notifications
  static async processMentions(
    messageId: string,
    content: string,
    authorId: string,
    campaignId: string,
    sceneId?: string
  ) {
    const mentionResult = await this.parseMentions(content, campaignId);

    if (mentionResult.mentionedUserIds.length === 0) {
      return mentionResult;
    }

    // Update message with mention data
    await prisma.message.update({
      where: { id: messageId },
      data: {
        mentionsUserIds: mentionResult.mentionedUserIds,
        hasMentions: true
      }
    });

    // Get author and campaign info for notifications
    const [author, campaign] = await Promise.all([
      prisma.user.findUnique({
        where: { id: authorId },
        select: { name: true, email: true }
      }),
      prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { title: true }
      })
    ]);

    const authorName = author?.name || author?.email || 'Someone';
    const campaignTitle = campaign?.title || 'the campaign';

    // Send mention notifications to each mentioned user
    for (const mention of mentionResult.mentions) {
      // Don't notify if user mentioned themselves
      if (mention.userId === authorId) continue;

      await NotificationService.createNotification({
        type: 'MENTION',
        title: `💬 ${authorName} mentioned you`,
        message: `${authorName} mentioned you in ${campaignTitle}: "${this.truncateMessage(content)}"`,
        userId: mention.userId,
        campaignId,
        sceneId,
        priority: 'NORMAL',
        actionUrl: `/campaigns/${campaignId}`,
        triggerSound: 'mention',
        metadata: {
          mentionedBy: authorName,
          messageContent: content,
          messageId,
          campaignTitle
        }
      });
    }

    return mentionResult;
  }

  // Get mention suggestions for autocomplete
  static async getMentionSuggestions(campaignId: string, query: string = '') {
    const members = await prisma.campaignMembership.findMany({
      where: { campaignId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    return members
      .map(m => ({
        userId: m.user.id,
        displayName: m.user.name || m.user.email,
        username: m.user.name?.toLowerCase() || m.user.email.split('@')[0].toLowerCase(),
        email: m.user.email
      }))
      .filter(user => {
        if (!query) return true;
        const searchQuery = query.toLowerCase();
        return user.username.includes(searchQuery) || 
               user.displayName.toLowerCase().includes(searchQuery) ||
               user.email.toLowerCase().includes(searchQuery);
      })
      .slice(0, 10); // Limit to 10 suggestions
  }

  // Parse mentions in notes and other content
  static async processMentionsInNote(
    noteId: string,
    content: string,
    authorId: string,
    campaignId: string,
    visibility: 'PRIVATE' | 'SHARED' | 'GM'
  ) {
    // Only process mentions for shared/GM notes
    if (visibility === 'PRIVATE') {
      return { mentionedUserIds: [], processedContent: content, mentions: [] };
    }

    const mentionResult = await this.parseMentions(content, campaignId);

    if (mentionResult.mentionedUserIds.length === 0) {
      return mentionResult;
    }

    // Get note and author info
    const [note, author] = await Promise.all([
      prisma.playerNote.findUnique({
        where: { id: noteId },
        select: { title: true }
      }),
      prisma.user.findUnique({
        where: { id: authorId },
        select: { name: true, email: true }
      })
    ]);

    const authorName = author?.name || author?.email || 'Someone';
    const noteTitle = note?.title || 'a note';

    // Send notifications
    for (const mention of mentionResult.mentions) {
      if (mention.userId === authorId) continue;

      await NotificationService.createNotification({
        type: 'MENTION',
        title: `📝 Mentioned in note: ${noteTitle}`,
        message: `${authorName} mentioned you in a campaign note: "${this.truncateMessage(content)}"`,
        userId: mention.userId,
        campaignId,
        priority: 'LOW',
        actionUrl: `/campaigns/${campaignId}?tab=notes`,
        metadata: {
          mentionedBy: authorName,
          noteTitle,
          noteId,
          noteContent: content
        }
      });
    }

    return mentionResult;
  }

  // Get recent mentions for a user
  static async getRecentMentions(userId: string, campaignId?: string, limit: number = 10) {
    const where: any = {
      type: 'MENTION',
      userId,
      status: { in: ['UNREAD', 'READ'] }
    };

    if (campaignId) {
      where.campaignId = campaignId;
    }

    return await prisma.notification.findMany({
      where,
      include: {
        campaign: {
          select: { title: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }

  // Mark mention as seen
  static async markMentionAsSeen(notificationId: string, userId: string) {
    return await NotificationService.markAsRead(notificationId, userId);
  }

  // Get mention statistics
  static async getMentionStats(userId: string, campaignId?: string) {
    const where: any = {
      type: 'MENTION',
      userId
    };

    if (campaignId) {
      where.campaignId = campaignId;
    }

    const [total, unread, thisWeek] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.count({ 
        where: { ...where, status: 'UNREAD' } 
      }),
      prisma.notification.count({ 
        where: { 
          ...where, 
          createdAt: { 
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) 
          } 
        } 
      })
    ]);

    return {
      totalMentions: total,
      unreadMentions: unread,
      mentionsThisWeek: thisWeek
    };
  }

  // Helper: Truncate message for notifications
  private static truncateMessage(content: string, maxLength: number = 100): string {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength - 3) + '...';
  }

  // Validate mention format
  static validateMention(mention: string): boolean {
    const mentionRegex = /^@\w+$/;
    return mentionRegex.test(mention);
  }

  // Extract usernames from text
  static extractUsernames(content: string): string[] {
    const mentionRegex = /@(\w+)/g;
    const matches = Array.from(content.matchAll(mentionRegex));
    return matches.map(match => match[1]);
  }

  // Replace mentions with display names
  static async replaceMentionsWithDisplayNames(content: string, campaignId: string): Promise<string> {
    const mentionResult = await this.parseMentions(content, campaignId);
    
    let processedContent = content;
    for (const mention of mentionResult.mentions) {
      const mentionPattern = new RegExp(`@${mention.username}\\b`, 'gi');
      processedContent = processedContent.replace(mentionPattern, `@${mention.displayName}`);
    }

    return processedContent;
  }
}

export default MentionService;
