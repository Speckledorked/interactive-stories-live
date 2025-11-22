/**
 * Phase 18.6: Campaign Export/Import Service
 *
 * Allows players to export campaigns, characters, and session data
 * Supports JSON format for full data export
 */

import { prisma } from '@/lib/prisma';

export interface ExportOptions {
  includeCharacters?: boolean;
  includeScenes?: boolean;
  includeSessions?: boolean;
  includeTimeline?: boolean;
  includeMessages?: boolean;
  includeNotes?: boolean;
  includeNPCs?: boolean;
  includeFactions?: boolean;
  includeClocks?: boolean;
  includeMoves?: boolean;
  includeWorldMeta?: boolean;
}

export interface CampaignExportData {
  version: string; // Export format version
  exportedAt: string;
  campaign: any;
  characters?: any[];
  scenes?: any[];
  sessions?: any[];
  timeline?: any[];
  messages?: any[];
  notes?: any[];
  npcs?: any[];
  factions?: any[];
  clocks?: any[];
  moves?: any[];
  worldMeta?: any;
}

export class CampaignExporter {
  /**
   * Export full campaign data
   */
  static async exportCampaign(
    campaignId: string,
    options: ExportOptions = {}
  ): Promise<CampaignExportData> {
    // Default to exporting everything
    const opts = {
      includeCharacters: true,
      includeScenes: true,
      includeSessions: true,
      includeTimeline: true,
      includeMessages: true,
      includeNotes: true,
      includeNPCs: true,
      includeFactions: true,
      includeClocks: true,
      includeMoves: true,
      includeWorldMeta: true,
      ...options,
    };

    // Fetch campaign
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        memberships: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    const exportData: CampaignExportData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      campaign: this.sanitizeCampaign(campaign),
    };

    // Fetch related data based on options
    if (opts.includeCharacters) {
      exportData.characters = await this.exportCharacters(campaignId);
    }

    if (opts.includeScenes) {
      exportData.scenes = await this.exportScenes(campaignId);
    }

    if (opts.includeSessions) {
      exportData.sessions = await this.exportSessions(campaignId);
    }

    if (opts.includeTimeline) {
      exportData.timeline = await this.exportTimeline(campaignId);
    }

    if (opts.includeMessages) {
      exportData.messages = await this.exportMessages(campaignId);
    }

    if (opts.includeNotes) {
      exportData.notes = await this.exportNotes(campaignId);
    }

    if (opts.includeNPCs) {
      exportData.npcs = await this.exportNPCs(campaignId);
    }

    if (opts.includeFactions) {
      exportData.factions = await this.exportFactions(campaignId);
    }

    if (opts.includeClocks) {
      exportData.clocks = await this.exportClocks(campaignId);
    }

    if (opts.includeMoves) {
      exportData.moves = await this.exportMoves(campaignId);
    }

    if (opts.includeWorldMeta) {
      exportData.worldMeta = await this.exportWorldMeta(campaignId);
    }

    return exportData;
  }

  /**
   * Export character data
   */
  static async exportCharacter(characterId: string) {
    const character = await prisma.character.findUnique({
      where: { id: characterId },
      include: {
        playerActions: {
          orderBy: { createdAt: 'asc' },
        },
        diceRolls: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return character;
  }

  /**
   * Export session transcript
   */
  static async exportSessionTranscript(sessionId: string) {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        participants: true,
        scenes: true,
        notes: {
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    // Get all scenes from this session
    const sceneIds = session.scenes.map((s) => s.sceneId);
    const scenes = await prisma.scene.findMany({
      where: { id: { in: sceneIds } },
      include: {
        playerActions: {
          include: {
            character: {
              select: { name: true, pronouns: true },
            },
            user: {
              select: { name: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        messages: {
          include: {
            author: {
              select: { name: true },
            },
            character: {
              select: { name: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { sceneNumber: 'asc' },
    });

    return {
      session,
      scenes,
      transcript: this.generateTranscript(scenes),
    };
  }

  // Private helper methods

  private static sanitizeCampaign(campaign: any) {
    // Remove sensitive data if needed
    return campaign;
  }

  private static async exportCharacters(campaignId: string) {
    return await prisma.character.findMany({
      where: { campaignId },
      include: {
        user: {
          select: { id: true, name: true },
        },
      },
    });
  }

  private static async exportScenes(campaignId: string) {
    return await prisma.scene.findMany({
      where: { campaignId },
      include: {
        playerActions: {
          include: {
            character: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: { sceneNumber: 'asc' },
    });
  }

  private static async exportSessions(campaignId: string) {
    const sessions = await prisma.session.findMany({
      where: {
        campaignId,
      },
      include: {
        participants: true,
        scenes: true,
        notes: true,
      },
      orderBy: { sessionNumber: 'asc' },
    });

    return sessions;
  }

  private static async exportTimeline(campaignId: string) {
    return await prisma.timelineEvent.findMany({
      where: { campaignId },
      orderBy: { turnNumber: 'asc' },
    });
  }

  private static async exportMessages(campaignId: string) {
    return await prisma.message.findMany({
      where: { campaignId },
      include: {
        author: {
          select: { name: true },
        },
        character: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private static async exportNotes(campaignId: string) {
    return await prisma.playerNote.findMany({
      where: { campaignId },
      include: {
        author: {
          select: { name: true },
        },
        character: {
          select: { name: true },
        },
        npc: {
          select: { name: true },
        },
        faction: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private static async exportNPCs(campaignId: string) {
    return await prisma.nPC.findMany({
      where: { campaignId },
      orderBy: { importance: 'desc' },
    });
  }

  private static async exportFactions(campaignId: string) {
    return await prisma.faction.findMany({
      where: { campaignId },
      orderBy: { influence: 'desc' },
    });
  }

  private static async exportClocks(campaignId: string) {
    return await prisma.clock.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private static async exportMoves(campaignId: string) {
    return await prisma.move.findMany({
      where: { campaignId },
      orderBy: { category: 'asc' },
    });
  }

  private static async exportWorldMeta(campaignId: string) {
    return await prisma.worldMeta.findUnique({
      where: { campaignId },
    });
  }

  /**
   * Generate human-readable transcript from scenes
   */
  private static generateTranscript(scenes: any[]): string {
    let transcript = '';

    for (const scene of scenes) {
      transcript += `\n\n========================================\n`;
      transcript += `SCENE ${scene.sceneNumber}: ${scene.title || 'Untitled'}\n`;
      transcript += `========================================\n\n`;

      if (scene.sceneIntroText) {
        transcript += `GM: ${scene.sceneIntroText}\n\n`;
      }

      // Interleave actions and messages by timestamp
      const events = [
        ...scene.playerActions.map((a: any) => ({ type: 'action', data: a, time: a.createdAt })),
        ...scene.messages.map((m: any) => ({ type: 'message', data: m, time: m.createdAt })),
      ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      for (const event of events) {
        if (event.type === 'action') {
          const action = event.data;
          transcript += `[ACTION] ${action.character.name}: ${action.actionText}\n`;
          if (action.resolution) {
            transcript += `  → ${action.resolution}\n`;
          }
          transcript += '\n';
        } else if (event.type === 'message') {
          const msg = event.data;
          const speaker = msg.character?.name || msg.author.name || 'Unknown';
          const prefix = msg.type === 'WHISPER' ? '[WHISPER]' : msg.type === 'SYSTEM' ? '[SYSTEM]' : '';
          transcript += `${prefix} ${speaker}: ${msg.content}\n`;
        }
      }

      if (scene.sceneResolutionText) {
        transcript += `\nGM RESOLUTION: ${scene.sceneResolutionText}\n`;
      }
    }

    return transcript;
  }

  /**
   * Import campaign from export data
   */
  static async importCampaign(data: CampaignExportData, userId: string, newTitle?: string) {
    // Validate export version
    if (!data.version || data.version !== '1.0.0') {
      throw new Error('Unsupported export format version');
    }

    // Create new campaign with imported data
    const campaignData = data.campaign;
    const newCampaign = await prisma.campaign.create({
      data: {
        title: newTitle || `${campaignData.title} (Imported)`,
        description: campaignData.description,
        universe: campaignData.universe,
        aiSystemPrompt: campaignData.aiSystemPrompt,
        initialWorldSeed: campaignData.initialWorldSeed,
        isActive: true,
        memberships: {
          create: {
            userId,
            role: 'ADMIN',
          },
        },
      },
    });

    // Import related data (optional, can be selective)
    if (data.npcs) {
      await this.importNPCs(newCampaign.id, data.npcs);
    }

    if (data.factions) {
      await this.importFactions(newCampaign.id, data.factions);
    }

    if (data.moves) {
      await this.importMoves(newCampaign.id, data.moves);
    }

    if (data.worldMeta) {
      await this.importWorldMeta(newCampaign.id, data.worldMeta);
    }

    // Note: Characters, scenes, and sessions are NOT imported
    // as they're tied to specific users and play sessions

    return newCampaign;
  }

  private static async importNPCs(campaignId: string, npcs: any[]) {
    for (const npc of npcs) {
      await prisma.nPC.create({
        data: {
          campaignId,
          name: npc.name,
          pronouns: npc.pronouns,
          description: npc.description,
          currentLocation: npc.currentLocation,
          goals: npc.goals,
          relationship: npc.relationship,
          isAlive: npc.isAlive,
          importance: npc.importance,
          gmNotes: npc.gmNotes,
          threat: npc.threat,
          impulses: npc.impulses,
          moves: npc.moves,
        },
      });
    }
  }

  private static async importFactions(campaignId: string, factions: any[]) {
    for (const faction of factions) {
      await prisma.faction.create({
        data: {
          campaignId,
          name: faction.name,
          description: faction.description,
          goals: faction.goals,
          resources: faction.resources,
          influence: faction.influence,
          currentPlan: faction.currentPlan,
          threatLevel: faction.threatLevel,
          relationships: faction.relationships,
          gmNotes: faction.gmNotes,
        },
      });
    }
  }

  private static async importMoves(campaignId: string, moves: any[]) {
    for (const move of moves) {
      await prisma.move.create({
        data: {
          campaignId,
          name: move.name,
          trigger: move.trigger,
          description: move.description,
          rollType: move.rollType,
          outcomes: move.outcomes,
          category: move.category,
          isActive: move.isActive,
        },
      });
    }
  }

  private static async importWorldMeta(campaignId: string, worldMeta: any) {
    await prisma.worldMeta.create({
      data: {
        campaignId,
        currentTurnNumber: 1, // Reset to 1 for new campaign
        currentInGameDate: worldMeta.currentInGameDate,
        currentLocation: worldMeta.currentLocation,
        tension: worldMeta.tension,
        phase: worldMeta.phase,
        otherMeta: worldMeta.otherMeta,
        gmNotes: worldMeta.gmNotes,
      },
    });
  }
}
