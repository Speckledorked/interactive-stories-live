// src/lib/notifications/turn-tracker.ts

import { prisma } from '@/lib/prisma';
import { NotificationService } from './notification-service';

export interface TurnOrder {
  userId: string;
  characterId?: string;
  name: string;
  isNPC?: boolean;
}

export class TurnTracker {

  // Initialize turn tracking for a scene
  static async initializeScene(
    campaignId: string, 
    sceneId: string, 
    participants: TurnOrder[],
    turnTimeoutMinutes: number = 60
  ) {
    // Delete existing turn tracker for this scene
    await prisma.turnTracker.deleteMany({
      where: { campaignId, sceneId }
    });

    // Create new turn tracker
    const turnTracker = await prisma.turnTracker.create({
      data: {
        campaignId,
        sceneId,
        currentTurn: 0,
        turnOrder: participants,
        turnStartedAt: new Date(),
        turnDeadline: new Date(Date.now() + turnTimeoutMinutes * 60 * 1000),
        turnTimeoutMinutes,
        autoAdvanceTurn: false
      }
    });

    // Notify first player
    if (participants.length > 0) {
      const firstPlayer = participants[0];
      await this.notifyPlayerTurn(campaignId, sceneId, firstPlayer, turnTimeoutMinutes);
    }

    return turnTracker;
  }

  // Advance to next turn
  static async advanceTurn(campaignId: string, sceneId: string, userId: string) {
    const turnTracker = await prisma.turnTracker.findFirst({
      where: { campaignId, sceneId }
    });

    if (!turnTracker) {
      throw new Error('Turn tracker not found');
    }

    const turnOrder = turnTracker.turnOrder as TurnOrder[];
    const currentPlayer = turnOrder[turnTracker.currentTurn];

    // Verify it's actually this user's turn
    if (currentPlayer.userId !== userId) {
      throw new Error('Not your turn');
    }

    // Calculate next turn
    const nextTurnIndex = (turnTracker.currentTurn + 1) % turnOrder.length;
    const nextPlayer = turnOrder[nextTurnIndex];
    const newDeadline = new Date(Date.now() + turnTracker.turnTimeoutMinutes * 60 * 1000);

    // Update turn tracker
    const updatedTracker = await prisma.turnTracker.update({
      where: { id: turnTracker.id },
      data: {
        currentTurn: nextTurnIndex,
        turnStartedAt: new Date(),
        turnDeadline: newDeadline,
        remindersSent: [],
        lastReminderSent: null
      }
    });

    // Notify next player
    await this.notifyPlayerTurn(
      campaignId, 
      sceneId, 
      nextPlayer, 
      turnTracker.turnTimeoutMinutes
    );

    // Update scene waiting list
    await prisma.scene.update({
      where: { id: sceneId },
      data: {
        turnDeadline: newDeadline,
        waitingOnUsers: [nextPlayer.userId]
      }
    });

    return updatedTracker;
  }

  // Skip a player's turn (auto-advance or GM action)
  static async skipTurn(campaignId: string, sceneId: string, reason: string = 'Timeout') {
    const turnTracker = await prisma.turnTracker.findFirst({
      where: { campaignId, sceneId }
    });

    if (!turnTracker) {
      throw new Error('Turn tracker not found');
    }

    const turnOrder = turnTracker.turnOrder as TurnOrder[];
    const skippedPlayer = turnOrder[turnTracker.currentTurn];

    // Notify that turn was skipped
    await NotificationService.createNotification({
      type: 'TURN_REMINDER',
      title: 'Turn Skipped',
      message: `Your turn was skipped due to: ${reason}`,
      userId: skippedPlayer.userId,
      campaignId,
      sceneId,
      priority: 'NORMAL',
      triggerSound: 'turn-skipped'
    });

    // Advance to next turn
    return await this.advanceTurn(campaignId, sceneId, skippedPlayer.userId);
  }

  // Send turn reminder to current player
  static async sendTurnReminder(campaignId: string, sceneId: string) {
    const turnTracker = await prisma.turnTracker.findFirst({
      where: { campaignId, sceneId }
    });

    if (!turnTracker) return;

    const turnOrder = turnTracker.turnOrder as TurnOrder[];
    const currentPlayer = turnOrder[turnTracker.currentTurn];
    const remindersSent = (turnTracker.remindersSent as Date[]) || [];

    // Don't send more than 3 reminders
    if (remindersSent.length >= 3) return;

    // Don't send reminders more than every 10 minutes
    if (turnTracker.lastReminderSent) {
      const timeSinceLastReminder = Date.now() - new Date(turnTracker.lastReminderSent).getTime();
      if (timeSinceLastReminder < 10 * 60 * 1000) return;
    }

    const timeRemaining = turnTracker.turnDeadline ? 
      Math.max(0, new Date(turnTracker.turnDeadline).getTime() - Date.now()) : 0;
    
    const minutesRemaining = Math.ceil(timeRemaining / (60 * 1000));

    await NotificationService.createNotification({
      type: 'TURN_REMINDER',
      title: '⏰ Turn Reminder',
      message: `It's your turn to act! ${minutesRemaining} minutes remaining.`,
      userId: currentPlayer.userId,
      campaignId,
      sceneId,
      priority: minutesRemaining <= 5 ? 'HIGH' : 'NORMAL',
      actionUrl: `/campaigns/${campaignId}`,
      triggerSound: 'turn-reminder',
      metadata: {
        character: currentPlayer.name,
        timeRemaining: minutesRemaining
      }
    });

    // Update tracker
    await prisma.turnTracker.update({
      where: { id: turnTracker.id },
      data: {
        remindersSent: [...remindersSent, new Date()],
        lastReminderSent: new Date()
      }
    });
  }

  // Notify player it's their turn
  private static async notifyPlayerTurn(
    campaignId: string,
    sceneId: string,
    player: TurnOrder,
    timeoutMinutes: number
  ) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { title: true }
    });

    await NotificationService.createNotification({
      type: 'TURN_REMINDER',
      title: '🎯 Your Turn!',
      message: `It's your turn as ${player.name}. You have ${timeoutMinutes} minutes to act.`,
      userId: player.userId,
      campaignId,
      sceneId,
      priority: 'HIGH',
      actionUrl: `/campaigns/${campaignId}`,
      triggerSound: 'your-turn',
      metadata: {
        character: player.name,
        timeoutMinutes,
        campaignTitle: campaign?.title
      }
    });
  }

  // Get current turn info
  static async getCurrentTurn(campaignId: string, sceneId: string) {
    const turnTracker = await prisma.turnTracker.findFirst({
      where: { campaignId, sceneId }
    });

    if (!turnTracker) return null;

    const turnOrder = turnTracker.turnOrder as TurnOrder[];
    const currentPlayer = turnOrder[turnTracker.currentTurn];

    const timeRemaining = turnTracker.turnDeadline ? 
      Math.max(0, new Date(turnTracker.turnDeadline).getTime() - Date.now()) : 0;

    return {
      currentPlayer,
      turnIndex: turnTracker.currentTurn,
      totalPlayers: turnOrder.length,
      timeRemainingMs: timeRemaining,
      timeRemainingMinutes: Math.ceil(timeRemaining / (60 * 1000)),
      turnStartedAt: turnTracker.turnStartedAt,
      turnDeadline: turnTracker.turnDeadline,
      turnOrder
    };
  }

  // Check for expired turns and auto-advance
  static async checkExpiredTurns() {
    const expiredTurns = await prisma.turnTracker.findMany({
      where: {
        turnDeadline: {
          lte: new Date()
        },
        autoAdvanceTurn: true
      },
      include: {
        campaign: {
          select: { title: true }
        }
      }
    });

    for (const tracker of expiredTurns) {
      try {
        await this.skipTurn(
          tracker.campaignId, 
          tracker.sceneId || '', 
          'Turn timeout'
        );
      } catch (error) {
        console.error('Failed to auto-advance turn:', error);
      }
    }

    return expiredTurns.length;
  }

  // Send periodic reminders for slow turns
  static async sendPeriodicReminders() {
    const activeTurns = await prisma.turnTracker.findMany({
      where: {
        turnDeadline: {
          gt: new Date()
        }
      }
    });

    for (const tracker of activeTurns) {
      const timeUntilDeadline = new Date(tracker.turnDeadline!).getTime() - Date.now();
      const minutesUntilDeadline = timeUntilDeadline / (60 * 1000);

      // Send reminder when 15 minutes left, 5 minutes left, 1 minute left
      const reminderThresholds = [15, 5, 1];
      const shouldSendReminder = reminderThresholds.some(threshold => {
        return minutesUntilDeadline <= threshold && minutesUntilDeadline > (threshold - 1);
      });

      if (shouldSendReminder && tracker.sceneId) {
        await this.sendTurnReminder(tracker.campaignId, tracker.sceneId);
      }
    }
  }

  // End scene and clear turn tracking
  static async endScene(campaignId: string, sceneId: string) {
    // Remove turn tracker
    await prisma.turnTracker.deleteMany({
      where: { campaignId, sceneId }
    });

    // Clear scene waiting list
    await prisma.scene.update({
      where: { id: sceneId },
      data: {
        turnDeadline: null,
        waitingOnUsers: null
      }
    });

    // Notify all participants that scene ended
    const scene = await prisma.scene.findUnique({
      where: { id: sceneId },
      include: {
        campaign: {
          include: {
            memberships: {
              include: {
                user: true
              }
            }
          }
        }
      }
    });

    if (scene) {
      for (const membership of scene.campaign.memberships) {
        await NotificationService.createNotification({
          type: 'SCENE_RESOLVED',
          title: '🎬 Scene Complete',
          message: 'The current scene has been resolved. Check out the results!',
          userId: membership.user.id,
          campaignId,
          sceneId,
          priority: 'NORMAL',
          actionUrl: `/campaigns/${campaignId}`,
          triggerSound: 'scene-complete'
        });
      }
    }
  }

  // Add player to existing turn order
  static async addPlayerToTurn(
    campaignId: string,
    sceneId: string,
    player: TurnOrder,
    insertAfterCurrent: boolean = true
  ) {
    const turnTracker = await prisma.turnTracker.findFirst({
      where: { campaignId, sceneId }
    });

    if (!turnTracker) {
      throw new Error('Turn tracker not found');
    }

    const turnOrder = turnTracker.turnOrder as TurnOrder[];
    const insertIndex = insertAfterCurrent ? 
      turnTracker.currentTurn + 1 : 
      turnOrder.length;

    turnOrder.splice(insertIndex, 0, player);

    await prisma.turnTracker.update({
      where: { id: turnTracker.id },
      data: { turnOrder }
    });

    return turnOrder;
  }

  // Remove player from turn order
  static async removePlayerFromTurn(
    campaignId: string,
    sceneId: string,
    userId: string
  ) {
    const turnTracker = await prisma.turnTracker.findFirst({
      where: { campaignId, sceneId }
    });

    if (!turnTracker) {
      throw new Error('Turn tracker not found');
    }

    const turnOrder = turnTracker.turnOrder as TurnOrder[];
    const playerIndex = turnOrder.findIndex(p => p.userId === userId);
    
    if (playerIndex === -1) {
      throw new Error('Player not found in turn order');
    }

    // Remove player
    turnOrder.splice(playerIndex, 1);

    // Adjust current turn index if necessary
    let newCurrentTurn = turnTracker.currentTurn;
    if (playerIndex < turnTracker.currentTurn) {
      newCurrentTurn--;
    } else if (playerIndex === turnTracker.currentTurn) {
      // Current player left, advance to next
      newCurrentTurn = newCurrentTurn % turnOrder.length;
    }

    await prisma.turnTracker.update({
      where: { id: turnTracker.id },
      data: { 
        turnOrder,
        currentTurn: newCurrentTurn
      }
    });

    return turnOrder;
  }
}

export default TurnTracker;
