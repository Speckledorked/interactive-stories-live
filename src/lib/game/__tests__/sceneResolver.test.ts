import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveScene, createNewScene, getCurrentScene, getRecentScenes, canUserResolveScene } from '../sceneResolver';

// Mock modules
vi.mock('@/lib/prisma', () => ({
  prisma: {
    scene: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    worldMeta: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    campaignMembership: {
      findUnique: vi.fn(),
    },
    character: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/ai/client', () => ({
  callAIGM: vi.fn(),
}));

vi.mock('@/lib/ai/worldState', () => ({
  buildSceneResolutionRequest: vi.fn(),
  generateNewSceneIntro: vi.fn(),
}));

vi.mock('../stateUpdater', () => ({
  applyWorldUpdates: vi.fn(),
  summarizeWorldUpdates: vi.fn(() => 'test summary'),
}));

// Import mocked modules
import { prisma } from '@/lib/prisma';
import { callAIGM } from '@/lib/ai/client';
import { buildSceneResolutionRequest } from '@/lib/ai/worldState';
import { applyWorldUpdates } from '../stateUpdater';

describe('Scene Resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveScene', () => {
    const mockCampaignId = 'campaign-123';
    const mockSceneId = 'scene-456';

    const mockScene = {
      id: mockSceneId,
      campaignId: mockCampaignId,
      sceneNumber: 1,
      status: 'AWAITING_ACTIONS',
      sceneIntroText: 'Scene intro',
      sceneResolutionText: null,
      playerActions: [
        {
          id: 'action-1',
          characterId: 'char-1',
          actionText: 'I attack the enemy',
          rollResult: null,
        },
      ],
    };

    const mockWorldMeta = {
      id: 'meta-1',
      campaignId: mockCampaignId,
      currentTurnNumber: 5,
    };

    const mockAIResponse = {
      scene_text: 'The battle was fierce. Your attack lands successfully!',
      world_updates: {
        timeline_events: [],
        clock_changes: [],
        npc_changes: [],
        character_changes: [],
        faction_changes: [],
        organic_advancement: [],
      },
    };

    it('should successfully resolve a scene', async () => {
      // Setup mocks
      vi.mocked(prisma.scene.findUnique).mockResolvedValueOnce(mockScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(prisma.worldMeta.update).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue({} as any);
      vi.mocked(callAIGM).mockResolvedValue(mockAIResponse);
      vi.mocked(applyWorldUpdates).mockResolvedValue(undefined);

      // Execute
      const result = await resolveScene(mockCampaignId, mockSceneId);

      // Verify
      expect(result.success).toBe(true);
      expect(result.sceneText).toBe(mockAIResponse.scene_text);
      expect(result.newTurnNumber).toBe(6);

      // Verify scene was marked as RESOLVING
      expect(prisma.scene.update).toHaveBeenCalledWith({
        where: { id: mockSceneId },
        data: { status: 'RESOLVING' },
      });

      // Verify scene was marked as RESOLVED
      expect(prisma.scene.update).toHaveBeenCalledWith({
        where: { id: mockSceneId },
        data: {
          sceneResolutionText: mockAIResponse.scene_text,
          status: 'RESOLVED',
        },
      });

      // Verify turn was incremented
      expect(prisma.worldMeta.update).toHaveBeenCalledWith({
        where: { id: mockWorldMeta.id },
        data: { currentTurnNumber: 6 },
      });
    });

    it('should throw error if scene not found', async () => {
      vi.mocked(prisma.scene.findUnique).mockResolvedValueOnce(null);

      await expect(resolveScene(mockCampaignId, mockSceneId)).rejects.toThrow('Scene not found');
    });

    it('should throw error if scene is not awaiting actions', async () => {
      const resolvedScene = { ...mockScene, status: 'RESOLVED' };
      vi.mocked(prisma.scene.findUnique).mockResolvedValueOnce(resolvedScene as any);

      await expect(resolveScene(mockCampaignId, mockSceneId)).rejects.toThrow(
        'Scene is not awaiting actions'
      );
    });

    it('should throw error if no player actions submitted', async () => {
      const sceneWithoutActions = { ...mockScene, playerActions: [] };
      vi.mocked(prisma.scene.findUnique).mockResolvedValueOnce(sceneWithoutActions as any);

      await expect(resolveScene(mockCampaignId, mockSceneId)).rejects.toThrow(
        'No player actions submitted yet'
      );
    });

    it('should revert scene status on error', async () => {
      vi.mocked(prisma.scene.findUnique).mockResolvedValueOnce(mockScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValueOnce(mockScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockRejectedValueOnce(new Error('Database error'));

      await expect(resolveScene(mockCampaignId, mockSceneId)).rejects.toThrow('Database error');

      // Verify scene status was reverted
      expect(prisma.scene.update).toHaveBeenCalledWith({
        where: { id: mockSceneId },
        data: { status: 'AWAITING_ACTIONS' },
      });
    });

    it('should call AI GM with correct parameters', async () => {
      const mockAIRequest = { campaign_id: mockCampaignId, scene_id: mockSceneId };

      vi.mocked(prisma.scene.findUnique).mockResolvedValueOnce(mockScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(prisma.worldMeta.update).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue(mockAIRequest as any);
      vi.mocked(callAIGM).mockResolvedValue(mockAIResponse);
      vi.mocked(applyWorldUpdates).mockResolvedValue(undefined);

      await resolveScene(mockCampaignId, mockSceneId);

      expect(buildSceneResolutionRequest).toHaveBeenCalledWith(mockCampaignId, mockSceneId);
      expect(callAIGM).toHaveBeenCalledWith(mockAIRequest);
    });
  });

  describe('createNewScene', () => {
    const mockCampaignId = 'campaign-123';

    it('should create a new scene with generated intro', async () => {
      const mockSceneIntro = 'A new adventure begins...';
      const mockNewScene = {
        id: 'new-scene-1',
        campaignId: mockCampaignId,
        sceneNumber: 3,
        sceneIntroText: mockSceneIntro,
        status: 'AWAITING_ACTIONS',
      };

      const lastScene = { sceneNumber: 2 };

      vi.mocked(prisma.scene.findFirst).mockResolvedValueOnce(lastScene as any);
      vi.mocked(prisma.scene.create).mockResolvedValueOnce(mockNewScene as any);

      // Mock the dynamic import
      vi.doMock('@/lib/ai/worldState', () => ({
        generateNewSceneIntro: vi.fn().mockResolvedValue(mockSceneIntro),
      }));

      const result = await createNewScene(mockCampaignId);

      expect(result.sceneNumber).toBe(3);
      expect(result.status).toBe('AWAITING_ACTIONS');
    });

    it('should create first scene with number 1 when no previous scenes exist', async () => {
      const mockSceneIntro = 'The story begins...';
      const mockNewScene = {
        id: 'first-scene',
        campaignId: mockCampaignId,
        sceneNumber: 1,
        sceneIntroText: mockSceneIntro,
        status: 'AWAITING_ACTIONS',
      };

      vi.mocked(prisma.scene.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.scene.create).mockResolvedValueOnce(mockNewScene as any);

      const result = await createNewScene(mockCampaignId);

      expect(result.sceneNumber).toBe(1);
    });

    it('should create scene with participants when character IDs provided', async () => {
      const mockSceneIntro = 'A new scene with specific characters...';
      const characterIds = ['char-1', 'char-2'];
      const mockCharacters = [
        { id: 'char-1', userId: 'user-1' },
        { id: 'char-2', userId: 'user-2' },
      ];

      vi.mocked(prisma.scene.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.character.findMany).mockResolvedValueOnce(mockCharacters as any);
      vi.mocked(prisma.scene.create).mockResolvedValueOnce({
        id: 'scene-1',
        sceneNumber: 1,
        participants: { characterIds, userIds: ['user-1', 'user-2'] },
      } as any);

      await createNewScene(mockCampaignId, characterIds);

      expect(prisma.character.findMany).toHaveBeenCalledWith({
        where: { id: { in: characterIds } },
        select: { id: true, userId: true },
      });
    });
  });

  describe('getCurrentScene', () => {
    const mockCampaignId = 'campaign-123';

    it('should return the current active scene', async () => {
      const mockScene = {
        id: 'scene-1',
        campaignId: mockCampaignId,
        status: 'AWAITING_ACTIONS',
        sceneNumber: 5,
        playerActions: [],
      };

      vi.mocked(prisma.scene.findFirst).mockResolvedValueOnce(mockScene as any);

      const result = await getCurrentScene(mockCampaignId);

      expect(result?.id).toBe('scene-1');
      expect(prisma.scene.findFirst).toHaveBeenCalledWith({
        where: {
          campaignId: mockCampaignId,
          status: { in: ['AWAITING_ACTIONS', 'RESOLVING'] },
        },
        include: {
          playerActions: {
            include: {
              character: true,
              user: { select: { id: true, email: true } },
            },
          },
        },
        orderBy: { sceneNumber: 'desc' },
      });
    });

    it('should return null when no active scene exists', async () => {
      vi.mocked(prisma.scene.findFirst).mockResolvedValueOnce(null);

      const result = await getCurrentScene(mockCampaignId);

      expect(result).toBeNull();
    });
  });

  describe('getRecentScenes', () => {
    const mockCampaignId = 'campaign-123';

    it('should return recent resolved scenes with default limit', async () => {
      const mockScenes = [
        { id: 'scene-5', sceneNumber: 5, status: 'RESOLVED' },
        { id: 'scene-4', sceneNumber: 4, status: 'RESOLVED' },
        { id: 'scene-3', sceneNumber: 3, status: 'RESOLVED' },
      ];

      vi.mocked(prisma.scene.findMany).mockResolvedValueOnce(mockScenes as any);

      const result = await getRecentScenes(mockCampaignId);

      expect(result.length).toBe(3);
      expect(prisma.scene.findMany).toHaveBeenCalledWith({
        where: {
          campaignId: mockCampaignId,
          status: 'RESOLVED',
        },
        include: {
          playerActions: {
            include: {
              character: { select: { name: true } },
              user: { select: { email: true } },
            },
          },
        },
        orderBy: { sceneNumber: 'desc' },
        take: 5,
      });
    });

    it('should respect custom limit parameter', async () => {
      vi.mocked(prisma.scene.findMany).mockResolvedValueOnce([] as any);

      await getRecentScenes(mockCampaignId, 10);

      expect(prisma.scene.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
        })
      );
    });
  });

  describe('canUserResolveScene', () => {
    const mockUserId = 'user-123';
    const mockCampaignId = 'campaign-456';

    it('should return true for admin users', async () => {
      const mockMembership = {
        userId: mockUserId,
        campaignId: mockCampaignId,
        role: 'ADMIN',
      };

      vi.mocked(prisma.campaignMembership.findUnique).mockResolvedValueOnce(mockMembership as any);

      const result = await canUserResolveScene(mockUserId, mockCampaignId);

      expect(result).toBe(true);
    });

    it('should return false for non-admin users', async () => {
      const mockMembership = {
        userId: mockUserId,
        campaignId: mockCampaignId,
        role: 'PLAYER',
      };

      vi.mocked(prisma.campaignMembership.findUnique).mockResolvedValueOnce(mockMembership as any);

      const result = await canUserResolveScene(mockUserId, mockCampaignId);

      expect(result).toBe(false);
    });

    it('should return false when membership not found', async () => {
      vi.mocked(prisma.campaignMembership.findUnique).mockResolvedValueOnce(null);

      const result = await canUserResolveScene(mockUserId, mockCampaignId);

      expect(result).toBe(false);
    });
  });
});
