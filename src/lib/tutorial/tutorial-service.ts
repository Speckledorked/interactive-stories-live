/**
 * Phase 16.5: Tutorial & Onboarding Service
 *
 * Manages tutorial progression, step tracking, and guided onboarding
 */

import prisma from '@/lib/prisma';
import { TutorialStatus } from '@prisma/client';

export interface TutorialStepData {
  stepKey: string;
  title: string;
  description: string;
  category: 'basics' | 'combat' | 'social' | 'advanced';
  orderIndex: number;
  isOptional?: boolean;
  prerequisites?: string[];
  contentBlocks?: Array<{
    type: 'text' | 'image' | 'video' | 'code' | 'tip' | 'warning';
    content: string;
    imageUrl?: string;
  }>;
  targetElement?: string;
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right';
  completionTrigger?: string;
  validationRules?: Record<string, any>;
}

export class TutorialService {
  /**
   * Initialize default tutorial steps
   */
  static async initializeTutorialSteps(): Promise<void> {
    const defaultSteps: TutorialStepData[] = [
      // Basics
      {
        stepKey: 'welcome',
        title: 'Welcome to Interactive Stories',
        description: 'Learn the basics of playing AI-powered tabletop RPG adventures',
        category: 'basics',
        orderIndex: 1,
        contentBlocks: [
          {
            type: 'text',
            content: 'Welcome! This tutorial will guide you through creating your first character and playing your first scene.',
          },
          {
            type: 'tip',
            content: 'You can skip the tutorial at any time, but we recommend completing it for the best experience.',
          },
        ],
        completionTrigger: 'click_continue',
      },
      {
        stepKey: 'create_character',
        title: 'Create Your Character',
        description: 'Design your first player character',
        category: 'basics',
        orderIndex: 2,
        prerequisites: ['welcome'],
        targetElement: '#create-character-button',
        tooltipPosition: 'bottom',
        contentBlocks: [
          {
            type: 'text',
            content: 'Click here to create your first character. Give them a name, pronouns, and a brief description.',
          },
          {
            type: 'tip',
            content: 'Your character\'s stats will be automatically assigned based on PbtA (Powered by the Apocalypse) rules.',
          },
        ],
        completionTrigger: 'character_created',
      },
      {
        stepKey: 'first_scene',
        title: 'Your First Scene',
        description: 'Learn how scenes work',
        category: 'basics',
        orderIndex: 3,
        prerequisites: ['create_character'],
        contentBlocks: [
          {
            type: 'text',
            content: 'The AI GM has created your first scene. Read the scene introduction to understand the situation.',
          },
          {
            type: 'tip',
            content: 'Scenes are the core of gameplay. The AI GM presents situations, and you respond with actions.',
          },
        ],
        completionTrigger: 'scene_read',
      },
      {
        stepKey: 'submit_action',
        title: 'Submit Your First Action',
        description: 'Declare what your character does',
        category: 'basics',
        orderIndex: 4,
        prerequisites: ['first_scene'],
        targetElement: '#action-textarea',
        tooltipPosition: 'top',
        contentBlocks: [
          {
            type: 'text',
            content: 'Describe what your character does in response to the scene. Be specific and creative!',
          },
          {
            type: 'warning',
            content: 'Once you submit an action, you cannot edit it. Think carefully!',
          },
        ],
        completionTrigger: 'action_submitted',
      },
      {
        stepKey: 'dice_roll',
        title: 'Rolling the Dice',
        description: 'Understand PbtA dice mechanics',
        category: 'basics',
        orderIndex: 5,
        prerequisites: ['submit_action'],
        contentBlocks: [
          {
            type: 'text',
            content: 'Some actions require a dice roll (2d6 + stat modifier). Results: 10+ = success, 7-9 = partial success, 6- = complication.',
          },
          {
            type: 'tip',
            content: 'The AI GM will tell you when a roll is needed and which stat to use.',
          },
        ],
        completionTrigger: 'dice_rolled',
      },
      {
        stepKey: 'scene_resolution',
        title: 'Scene Resolution',
        description: 'See how the AI GM responds',
        category: 'basics',
        orderIndex: 6,
        prerequisites: ['submit_action'],
        contentBlocks: [
          {
            type: 'text',
            content: 'The AI GM processes all player actions and creates a resolution that advances the story.',
          },
          {
            type: 'tip',
            content: 'Pay attention to how your actions affect the world and other characters.',
          },
        ],
        completionTrigger: 'scene_resolved',
      },

      // Chat & Communication
      {
        stepKey: 'chat_basics',
        title: 'Using Chat',
        description: 'Communicate with other players',
        category: 'social',
        orderIndex: 7,
        prerequisites: ['scene_resolution'],
        targetElement: '#chat-panel',
        tooltipPosition: 'left',
        contentBlocks: [
          {
            type: 'text',
            content: 'Use the chat panel to talk with other players. Toggle between in-character (IC) and out-of-character (OOC) modes.',
          },
        ],
        completionTrigger: 'message_sent',
        isOptional: true,
      },
      {
        stepKey: 'notes_system',
        title: 'Taking Notes',
        description: 'Keep track of important information',
        category: 'social',
        orderIndex: 8,
        prerequisites: ['scene_resolution'],
        targetElement: '#notes-panel',
        tooltipPosition: 'left',
        contentBlocks: [
          {
            type: 'text',
            content: 'Create notes to remember NPCs, clues, or plot points. Notes can be private, GM-only, or shared.',
          },
        ],
        completionTrigger: 'note_created',
        isOptional: true,
      },

      // Combat
      {
        stepKey: 'combat_intro',
        title: 'Combat Basics',
        description: 'Learn how combat works',
        category: 'combat',
        orderIndex: 9,
        prerequisites: ['scene_resolution'],
        contentBlocks: [
          {
            type: 'text',
            content: 'Combat is freeform by default - no strict turn order. Describe your actions naturally.',
          },
          {
            type: 'tip',
            content: 'The AI GM can switch to structured combat if needed for complex battles.',
          },
        ],
        completionTrigger: 'combat_action_submitted',
        isOptional: true,
      },
      {
        stepKey: 'zones',
        title: 'Zone Positioning',
        description: 'Understand tactical positioning',
        category: 'combat',
        orderIndex: 10,
        prerequisites: ['combat_intro'],
        contentBlocks: [
          {
            type: 'text',
            content: 'Characters occupy zones: Close, Near, Far, Distant. Your zone affects what actions you can take.',
          },
        ],
        completionTrigger: 'zone_changed',
        isOptional: true,
      },

      // Advanced
      {
        stepKey: 'moves_system',
        title: 'Character Moves',
        description: 'Learn about special moves',
        category: 'advanced',
        orderIndex: 11,
        prerequisites: ['dice_roll'],
        contentBlocks: [
          {
            type: 'text',
            content: 'Moves are special abilities triggered by specific actions. Each has unique outcomes.',
          },
        ],
        completionTrigger: 'move_triggered',
        isOptional: true,
      },
      {
        stepKey: 'advancement',
        title: 'Character Growth',
        description: 'Understand experience and advancement',
        category: 'advanced',
        orderIndex: 12,
        prerequisites: ['scene_resolution'],
        contentBlocks: [
          {
            type: 'text',
            content: 'Gain XP by rolling 6- (failures) or achieving session objectives. Use XP to increase stats or gain perks.',
          },
        ],
        completionTrigger: 'xp_gained',
        isOptional: true,
      },
    ];

    // Upsert all steps
    for (const step of defaultSteps) {
      await prisma.tutorialStep.upsert({
        where: { stepKey: step.stepKey },
        update: {
          title: step.title,
          description: step.description,
          category: step.category,
          orderIndex: step.orderIndex,
          isOptional: step.isOptional || false,
          prerequisites: step.prerequisites || [],
          contentBlocks: step.contentBlocks || [],
          targetElement: step.targetElement,
          tooltipPosition: step.tooltipPosition || 'bottom',
          completionTrigger: step.completionTrigger,
          validationRules: step.validationRules,
        },
        create: step,
      });
    }
  }

  /**
   * Get user's tutorial progress
   */
  static async getUserProgress(userId: string) {
    const allSteps = await prisma.tutorialStep.findMany({
      orderBy: { orderIndex: 'asc' },
      include: {
        userProgress: {
          where: { userId },
        },
      },
    });

    return allSteps.map((step) => ({
      ...step,
      userProgress: step.userProgress[0] || null,
    }));
  }

  /**
   * Get next tutorial step for user
   */
  static async getNextStep(userId: string) {
    const progress = await this.getUserProgress(userId);

    // Find first incomplete required step
    for (const step of progress) {
      if (step.isOptional) continue;
      if (!step.userProgress || step.userProgress.status !== TutorialStatus.COMPLETED) {
        // Check prerequisites
        const prereqsMet = step.prerequisites.every((prereqKey) => {
          const prereqStep = progress.find((s) => s.stepKey === prereqKey);
          return (
            prereqStep?.userProgress?.status === TutorialStatus.COMPLETED ||
            prereqStep?.userProgress?.status === TutorialStatus.SKIPPED
          );
        });

        if (prereqsMet) {
          return step;
        }
      }
    }

    return null; // Tutorial complete
  }

  /**
   * Start a tutorial step
   */
  static async startStep(userId: string, stepId: string) {
    return await prisma.userTutorialProgress.upsert({
      where: {
        userId_stepId: { userId, stepId },
      },
      update: {
        status: TutorialStatus.IN_PROGRESS,
        startedAt: new Date(),
      },
      create: {
        userId,
        stepId,
        status: TutorialStatus.IN_PROGRESS,
        startedAt: new Date(),
      },
    });
  }

  /**
   * Complete a tutorial step
   */
  static async completeStep(userId: string, stepId: string) {
    return await prisma.userTutorialProgress.upsert({
      where: {
        userId_stepId: { userId, stepId },
      },
      update: {
        status: TutorialStatus.COMPLETED,
        completedAt: new Date(),
      },
      create: {
        userId,
        stepId,
        status: TutorialStatus.COMPLETED,
        completedAt: new Date(),
      },
    });
  }

  /**
   * Skip a tutorial step
   */
  static async skipStep(userId: string, stepId: string) {
    return await prisma.userTutorialProgress.upsert({
      where: {
        userId_stepId: { userId, stepId },
      },
      update: {
        status: TutorialStatus.SKIPPED,
        skippedAt: new Date(),
      },
      create: {
        userId,
        stepId,
        status: TutorialStatus.SKIPPED,
        skippedAt: new Date(),
      },
    });
  }

  /**
   * Track tutorial interaction (hints viewed, time spent, etc.)
   */
  static async trackInteraction(
    userId: string,
    stepId: string,
    type: 'hint' | 'attempt' | 'timeSpent',
    value: number = 1
  ) {
    const progress = await prisma.userTutorialProgress.findUnique({
      where: { userId_stepId: { userId, stepId } },
    });

    if (!progress) {
      // Create if doesn't exist
      await this.startStep(userId, stepId);
    }

    const updateData: any = {};
    if (type === 'hint') {
      updateData.hintsViewed = { increment: value };
    } else if (type === 'attempt') {
      updateData.attemptsCount = { increment: value };
    } else if (type === 'timeSpent') {
      updateData.timeSpent = { increment: value };
    }

    return await prisma.userTutorialProgress.update({
      where: { userId_stepId: { userId, stepId } },
      data: updateData,
    });
  }

  /**
   * Enable/disable tutorial mode for a campaign
   */
  static async setCampaignTutorialMode(
    campaignId: string,
    settings: {
      isEnabled?: boolean;
      useGuidedScenes?: boolean;
      showTooltips?: boolean;
      provideHints?: boolean;
      allowSkip?: boolean;
    }
  ) {
    return await prisma.campaignTutorialMode.upsert({
      where: { campaignId },
      update: settings,
      create: {
        campaignId,
        ...settings,
      },
    });
  }

  /**
   * Check if campaign is in tutorial mode
   */
  static async isCampaignTutorial(campaignId: string): Promise<boolean> {
    const tutorialMode = await prisma.campaignTutorialMode.findUnique({
      where: { campaignId },
    });
    return tutorialMode?.isEnabled || false;
  }

  /**
   * Handle tutorial trigger events (e.g., "character_created", "action_submitted")
   */
  static async handleTriggerEvent(userId: string, trigger: string, metadata?: Record<string, any>) {
    // Find steps with this completion trigger
    const steps = await prisma.tutorialStep.findMany({
      where: { completionTrigger: trigger },
      include: {
        userProgress: {
          where: { userId },
        },
      },
    });

    for (const step of steps) {
      const progress = step.userProgress[0];
      if (progress?.status === TutorialStatus.IN_PROGRESS) {
        // Auto-complete the step
        await this.completeStep(userId, step.id);
      }
    }
  }

  /**
   * Get tutorial completion percentage for user
   */
  static async getCompletionPercentage(userId: string): Promise<number> {
    const allSteps = await prisma.tutorialStep.findMany({
      where: { isOptional: false },
      include: {
        userProgress: {
          where: { userId },
        },
      },
    });

    const totalRequired = allSteps.length;
    if (totalRequired === 0) return 100;

    const completed = allSteps.filter(
      (step) => step.userProgress[0]?.status === TutorialStatus.COMPLETED
    ).length;

    return Math.round((completed / totalRequired) * 100);
  }
}
