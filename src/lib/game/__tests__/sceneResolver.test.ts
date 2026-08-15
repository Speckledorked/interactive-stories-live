import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveScene, createNewScene, getCurrentScene, getRecentScenes, canUserResolveScene, fallbackSummaryFromSceneText, appendSummarySegment, isFirstSceneExchange } from '../sceneResolver';

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
    // Looked up by the map-generation step (sceneResolver.ts) to find the
    // campaign's active map, if any — findFirst resolving to undefined
    // (the vi.fn() default) is fine, it just means "no active map yet".
    // (#291: the actual generation — and pruneOldMaps — now run inside
    // mapGenQueue.ts's worker, mocked as a black box below, so no other
    // Map methods are needed here.)
    map: {
      findFirst: vi.fn(),
    },
    // Battle-map generation is opt-in per campaign (#9/#59) — the resolver
    // reads this flag before doing any map work.
    campaign: {
      findUnique: vi.fn(),
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

// #stakes: createNewScene reaches this via a dynamic await import(...),
// same as its existing generateNewSceneIntro call — mocked explicitly
// (rather than relying on the real module's own no-API-key fail-open)
// so createNewScene's behavior around a stakes value is actually pinned.
vi.mock('@/lib/ai/sceneStakes', () => ({
  generateSceneStakes: vi.fn().mockResolvedValue(null),
}));

vi.mock('../stateUpdater', () => ({
  applyWorldUpdates: vi.fn(),
  summarizeWorldUpdates: vi.fn(() => 'test summary'),
  enrichStubNPCs: vi.fn().mockResolvedValue(undefined),
  enrichStubFactions: vi.fn().mockResolvedValue(undefined),
}));

// resolveScene's orchestration is what this file tests — everything below
// is a supporting subsystem performResolution calls into, mocked as a black
// box rather than fed enough prisma mocks to satisfy its internals. This
// mirrors the existing stateUpdater mock above rather than trying to
// individually mock every prisma call ~10 different subsystems make.
vi.mock('../exchange-manager', () => ({
  // Regular function, not an arrow function — arrow functions have no
  // [[Construct]] internal slot, so `new ExchangeManager()` throws
  // "is not a constructor" if the mock implementation is an arrow fn.
  ExchangeManager: vi.fn().mockImplementation(function () {
    return {
      canResolveExchange: vi.fn().mockResolvedValue(true),
      getExchangeSummary: vi.fn().mockResolvedValue({
        exchangeNumber: 1,
        playersActed: 1,
        totalPlayers: 1,
        complexity: 'simple',
        canResolve: true,
      }),
      completeExchange: vi.fn().mockResolvedValue(undefined),
      initializeExchange: vi.fn().mockResolvedValue({}),
      recordAction: vi.fn().mockResolvedValue({}),
    }
  }),
}));

vi.mock('../campaign-health', () => ({
  CampaignHealthMonitor: vi.fn().mockImplementation(function () {
    return {
      calculateHealth: vi.fn().mockResolvedValue({ isHealthy: true, score: 100, issues: [], recommendations: [] }),
      recordHealthCheck: vi.fn().mockResolvedValue(undefined),
    }
  }),
}));

vi.mock('../world-state-tracker', () => ({
  captureWorldStateSnapshot: vi.fn().mockResolvedValue({}),
  detectWorldStateChanges: vi.fn().mockResolvedValue([]),
  storeWorldStateChanges: vi.fn().mockResolvedValue(undefined),
  createCharacterProgressionNotifications: vi.fn().mockResolvedValue(undefined),
}));

// #291: map generation is now an async job, mirroring how ../imageGenQueue
// (scene illustration) is already mocked as a black box below — only the
// enqueue call is asserted, never the actual generation.
vi.mock('../mapGenQueue', () => ({
  enqueueMapGeneration: vi.fn().mockResolvedValue({ jobId: 'map1', deduped: false }),
}));

vi.mock('@/lib/ai/memoryCreation', () => ({
  createSceneMemory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../consequences', () => ({
  extractAndApplyConsequences: vi.fn().mockResolvedValue({ consequencesFound: 0, changes: [], historyEntriesCreated: 0 }),
}));

// #96: scene illustration — resolveScene reaches these via a dynamic
// await import(...), same as its existing generateNewSceneIntro call, but
// vi.mock still intercepts them since the mock registration is hoisted
// above any import (static or dynamic) that resolves at runtime.
vi.mock('../../ai/imageGeneration', () => ({
  buildScenePrompt: vi.fn().mockReturnValue('a generated illustration prompt'),
}));
vi.mock('../imageGenQueue', () => ({
  enqueueSceneImageGeneration: vi.fn().mockResolvedValue({ jobId: 'img1', deduped: false }),
}));

// Import mocked modules
import { prisma } from '@/lib/prisma';
import { callAIGM } from '@/lib/ai/client';
import { buildSceneResolutionRequest } from '@/lib/ai/worldState';
import { applyWorldUpdates } from '../stateUpdater';
import { enqueueMapGeneration } from '../mapGenQueue';
import { storeWorldStateChanges, detectWorldStateChanges } from '../world-state-tracker';
import { buildScenePrompt } from '../../ai/imageGeneration';
import { enqueueSceneImageGeneration } from '../imageGenQueue';
import { generateSceneStakes } from '@/lib/ai/sceneStakes';

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
          // applyOrganicCharacterGrowth re-fetches the scene with
          // playerActions.character included and reads fields off it
          // directly (character.statUsage, etc.) — needs a real object here,
          // not just a characterId.
          character: {
            id: 'char-1',
            name: 'Test Character',
            statUsage: null,
            perks: null,
            moves: [],
            stats: {},
            advancementLog: null,
          },
        },
      ],
    };

    const mockWorldMeta = {
      id: 'meta-1',
      campaignId: mockCampaignId,
      currentTurnNumber: 5,
      totalElapsedGameHours: 0,
      // Non-null so tests exercise ordinary scene resolution, not the
      // legacy-calendar-backfill path (calendarBackfill.test.ts covers
      // that separately).
      campaign: { id: mockCampaignId, title: 'Test Campaign', description: '', universe: 'Fantasy', calendarConfig: { epochLabel: '', daysPerWeek: 7, weekdayNames: ['A','B','C','D','E','F','G'], months: [{ name: 'Month 1', days: 30 }], startingYear: 1, startingMonthIndex: 0, startingDay: 1 } },
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
      // resolveScene's Phase 16 ExchangeManager check calls scene.findUnique
      // internally before resolveScene reaches its own lookup, so this needs
      // to be a persistent mock (not Once) or the later calls fall through
      // to an unconfigured default and the exchange check throws "Scene not
      // found" before the actual test logic ever runs.
      vi.mocked(prisma.scene.findUnique).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(prisma.worldMeta.update).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue({} as any);
      vi.mocked(callAIGM).mockResolvedValue(mockAIResponse);
      vi.mocked(applyWorldUpdates).mockResolvedValue({ involvedNpcIds: [], involvedFactionIds: [], unresolvedCharacterNames: [], worldChanges: [] });
      // Maps are opt-in per campaign and default OFF (#9/#59); this test
      // asserts the generation path, so enable them for this campaign.
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ mapGenerationEnabled: true } as any);

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

      // Scene stays AWAITING_ACTIONS (not RESOLVED) so it remains active for
      // continuous play — see the "Keep scene active for continuous play"
      // comment in sceneResolver.ts.
      expect(prisma.scene.update).toHaveBeenCalledWith({
        where: { id: mockSceneId },
        data: {
          sceneResolutionText: mockAIResponse.scene_text,
          status: 'AWAITING_ACTIONS',
        },
      });

      // Verify turn was incremented (currentInGameDate is always recomputed
      // fresh from totalElapsedGameHours + the fixture's calendar via
      // formatInGameDate — see calendar.ts — rather than string-mutated the
      // way the old calculateNewDate did).
      // hoursSinceWorldTurn banks this exchange's in-game time toward the
      // next world turn — 0 here since the fixture has no time_passage.
      // hoursBankedSinceLastHeartbeat tracks the same amount, so the cron
      // heartbeat sweep knows how much of the real-time gap play already
      // covered (see lib/game/cronHeartbeat.ts).
      expect(prisma.worldMeta.update).toHaveBeenCalledWith({
        where: { id: mockWorldMeta.id },
        data: {
          currentTurnNumber: 6,
          currentInGameDate: '1 Month 1, Year 1',
          totalElapsedGameHours: 0,
          hoursSinceWorldTurn: { increment: 0 },
          hoursBankedSinceLastHeartbeat: { increment: 0 },
        },
      });

      // mockScene.sceneResolutionText is null — this is the scene's first
      // exchange, so map generation should be enqueued.
      expect(enqueueMapGeneration).toHaveBeenCalledWith(mockCampaignId, mockSceneId, mockAIResponse.scene_text, undefined);
    });

    // #91: client.ts's callAIGM stamps _outcomeAdherence onto its response
    // (see client.ts's addValidationMetadata-style pattern); this confirms
    // sceneResolver.ts actually forwards it to storeWorldStateChanges rather
    // than letting it dead-end after the AI call.
    it('passes the AI response\'s _outcomeAdherence through to storeWorldStateChanges', async () => {
      vi.mocked(prisma.scene.findUnique).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(prisma.worldMeta.update).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue({} as any);
      const adherence = {
        entries: [{ characterName: 'Kess', rolled: 'weakHit', narrated: 'miss', verdict: 'mismatch' }],
        matched: 0,
        mismatched: 1,
        unreported: 0,
        ambiguous: 0,
        problems: ['Kess: engine rolled weakHit, narration reported miss'],
      };
      vi.mocked(callAIGM).mockResolvedValue({ ...mockAIResponse, _outcomeAdherence: adherence } as any);
      vi.mocked(applyWorldUpdates).mockResolvedValue({ involvedNpcIds: [], involvedFactionIds: [], unresolvedCharacterNames: [], worldChanges: [] });
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ mapGenerationEnabled: false } as any);

      await resolveScene(mockCampaignId, mockSceneId);

      expect(storeWorldStateChanges).toHaveBeenCalledWith(
        mockSceneId,
        expect.any(Array),
        adherence,
        // #232: moveVariety — no outcome_echo on mockAIResponse, so the
        // measurement is empty rather than absent.
        { entries: [], reported: 0, unreported: 0, repeated: 0 }
      );
    });

    // #200: the dice engine failing open (missing OPENAI_API_KEY, an
    // OpenAI outage) used to be indistinguishable from "nothing needed
    // rolling" — this confirms it now surfaces as a real, visible
    // worldStateChanges entry instead of only a server log line.
    it('surfaces a visible worldStateChanges entry when the AI request flags _mechanicsUnavailable', async () => {
      vi.mocked(prisma.scene.findUnique).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(prisma.worldMeta.update).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue({ _mechanicsUnavailable: true } as any);
      vi.mocked(callAIGM).mockResolvedValue({ ...mockAIResponse } as any);
      vi.mocked(applyWorldUpdates).mockResolvedValue({ involvedNpcIds: [], involvedFactionIds: [], unresolvedCharacterNames: [], worldChanges: [] });
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ mapGenerationEnabled: false } as any);
      // Fresh array per test: the file-level mock resolves to one shared []
      // literal, so pushing into it here (as this test's own assertion
      // relies on) would otherwise leak into every later test in this file.
      vi.mocked(detectWorldStateChanges).mockResolvedValueOnce([]);

      await resolveScene(mockCampaignId, mockSceneId);

      const changes = vi.mocked(storeWorldStateChanges).mock.calls[0][1];
      expect(changes).toContainEqual(
        expect.objectContaining({ category: 'consequence', type: 'failed', entityName: 'Dice Mechanics' })
      );
    });

    it('does not add a worldStateChanges entry when mechanics resolved normally', async () => {
      vi.mocked(prisma.scene.findUnique).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(prisma.worldMeta.update).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue({ _mechanicsUnavailable: false } as any);
      vi.mocked(detectWorldStateChanges).mockResolvedValueOnce([]);
      vi.mocked(callAIGM).mockResolvedValue({ ...mockAIResponse } as any);
      vi.mocked(applyWorldUpdates).mockResolvedValue({ involvedNpcIds: [], involvedFactionIds: [], unresolvedCharacterNames: [], worldChanges: [] });
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ mapGenerationEnabled: false } as any);

      await resolveScene(mockCampaignId, mockSceneId);

      const changes = vi.mocked(storeWorldStateChanges).mock.calls[0][1];
      expect(changes).not.toContainEqual(
        expect.objectContaining({ entityName: 'Dice Mechanics' })
      );
    });

    it('does not generate a map when the campaign has map generation off (the default)', async () => {
      vi.mocked(prisma.scene.findUnique).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(prisma.worldMeta.update).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue({} as any);
      vi.mocked(callAIGM).mockResolvedValue(mockAIResponse);
      vi.mocked(applyWorldUpdates).mockResolvedValue({ involvedNpcIds: [], involvedFactionIds: [], unresolvedCharacterNames: [], worldChanges: [] });
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ mapGenerationEnabled: false } as any);

      const result = await resolveScene(mockCampaignId, mockSceneId);

      // The scene still resolves normally — maps are an optional extra, and
      // skipping them costs an AI call and a batch of zone/token writes.
      expect(result.success).toBe(true);
      expect(enqueueMapGeneration).not.toHaveBeenCalled();
    });

    it('still resolves the scene when the map-settings lookup itself fails', async () => {
      vi.mocked(prisma.scene.findUnique).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(prisma.worldMeta.update).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue({} as any);
      vi.mocked(callAIGM).mockResolvedValue(mockAIResponse);
      vi.mocked(applyWorldUpdates).mockResolvedValue({ involvedNpcIds: [], involvedFactionIds: [], unresolvedCharacterNames: [], worldChanges: [] });
      vi.mocked(prisma.campaign.findUnique).mockRejectedValue(new Error('db blip'));

      const result = await resolveScene(mockCampaignId, mockSceneId);

      // The whole map step is non-critical, including reading whether maps
      // are even enabled — a failure there must never take down an
      // otherwise-successful scene resolution.
      expect(result.success).toBe(true);
      expect(enqueueMapGeneration).not.toHaveBeenCalled();
      // Same non-critical guarantee applies to the (separate) scene-image
      // settings lookup, which fails from the same rejected mock.
      expect(enqueueSceneImageGeneration).not.toHaveBeenCalled();
    });

    // #96: scene illustration — mirrors the map-generation tests directly
    // above, since it's gated the same way (per-campaign opt-in,
    // isFirstSceneExchange).
    it('enqueues scene image generation when enabled for this campaign', async () => {
      vi.mocked(prisma.scene.findUnique).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(prisma.worldMeta.update).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue({} as any);
      vi.mocked(callAIGM).mockResolvedValue(mockAIResponse);
      vi.mocked(applyWorldUpdates).mockResolvedValue({ involvedNpcIds: [], involvedFactionIds: [], unresolvedCharacterNames: [], worldChanges: [] });
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ mapGenerationEnabled: false, sceneImageGenerationEnabled: true } as any);

      const result = await resolveScene(mockCampaignId, mockSceneId);

      expect(result.success).toBe(true);
      expect(buildScenePrompt).toHaveBeenCalledWith(
        expect.objectContaining({ sceneIntroText: mockScene.sceneIntroText, framing: undefined, location: undefined })
      );
      expect(enqueueSceneImageGeneration).toHaveBeenCalledWith(mockCampaignId, mockSceneId, 'a generated illustration prompt');
    });

    it('does not enqueue scene image generation when the campaign has it off (the default)', async () => {
      vi.mocked(prisma.scene.findUnique).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(prisma.worldMeta.update).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue({} as any);
      vi.mocked(callAIGM).mockResolvedValue(mockAIResponse);
      vi.mocked(applyWorldUpdates).mockResolvedValue({ involvedNpcIds: [], involvedFactionIds: [], unresolvedCharacterNames: [], worldChanges: [] });
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ mapGenerationEnabled: false, sceneImageGenerationEnabled: false } as any);

      const result = await resolveScene(mockCampaignId, mockSceneId);

      expect(result.success).toBe(true);
      expect(enqueueSceneImageGeneration).not.toHaveBeenCalled();
    });

    it('does not enqueue a second scene image on a later exchange of the same scene', async () => {
      const sceneWithExistingResolution = { ...mockScene, sceneResolutionText: 'Something already happened here.' };
      vi.mocked(prisma.scene.findUnique).mockResolvedValue(sceneWithExistingResolution as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(sceneWithExistingResolution as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(prisma.worldMeta.update).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue({} as any);
      vi.mocked(callAIGM).mockResolvedValue(mockAIResponse);
      vi.mocked(applyWorldUpdates).mockResolvedValue({ involvedNpcIds: [], involvedFactionIds: [], unresolvedCharacterNames: [], worldChanges: [] });
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ mapGenerationEnabled: false, sceneImageGenerationEnabled: true } as any);

      const result = await resolveScene(mockCampaignId, mockSceneId);

      expect(result.success).toBe(true);
      expect(enqueueSceneImageGeneration).not.toHaveBeenCalled();
    });

    it('still resolves the scene when enqueueing the image itself throws', async () => {
      vi.mocked(prisma.scene.findUnique).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(prisma.worldMeta.update).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue({} as any);
      vi.mocked(callAIGM).mockResolvedValue(mockAIResponse);
      vi.mocked(applyWorldUpdates).mockResolvedValue({ involvedNpcIds: [], involvedFactionIds: [], unresolvedCharacterNames: [], worldChanges: [] });
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ mapGenerationEnabled: false, sceneImageGenerationEnabled: true } as any);
      vi.mocked(enqueueSceneImageGeneration).mockRejectedValueOnce(new Error('worker kick failed'));

      const result = await resolveScene(mockCampaignId, mockSceneId);

      // Enqueueing the image job is non-critical, same as map generation —
      // a failure there must never take down an otherwise-successful scene
      // resolution.
      expect(result.success).toBe(true);
    });

    it('should throw error if scene not found', async () => {
      vi.mocked(prisma.scene.findUnique).mockResolvedValue(null);

      await expect(resolveScene(mockCampaignId, mockSceneId)).rejects.toThrow('Scene not found');
    });

    it('should throw error if scene is not awaiting actions', async () => {
      const resolvedScene = { ...mockScene, status: 'RESOLVED' };
      vi.mocked(prisma.scene.findUnique).mockResolvedValue(resolvedScene as any);

      await expect(resolveScene(mockCampaignId, mockSceneId)).rejects.toThrow(
        'Scene is not ready to resolve'
      );
    });

    it('should throw error if scene is paused by an X-Card', async () => {
      const pausedScene = { ...mockScene, isPaused: true };
      vi.mocked(prisma.scene.findUnique).mockResolvedValue(pausedScene as any);

      await expect(resolveScene(mockCampaignId, mockSceneId)).rejects.toThrow(
        'Scene is paused'
      );
    });

    // #273: the pre-call isPaused check above only catches a pause that was
    // already active before resolution started. An X-Card pulled DURING the
    // ~150s AI call — the exact window this safety tool exists to interrupt
    // — was previously invisible: nothing re-checked isPaused after the AI
    // response came back, so the generated narration would still be
    // persisted and broadcast to every player's screen.
    it('#273: discards the resolution if the scene is paused while the AI call is in flight', async () => {
      let sceneFindUniqueCallCount = 0;
      (prisma.scene.findUnique as any).mockImplementation(async () => {
        sceneFindUniqueCallCount++;
        // 1st call: resolveScene's own pre-call gate — must be unpaused, or
        // resolution never starts in the first place, defeating the test.
        // 2nd call: the new fresh re-check right after callAIGM returns —
        // simulates an X-Card pulled while the AI call was in flight.
        return { ...mockScene, isPaused: sceneFindUniqueCallCount >= 2 } as any;
      });
      vi.mocked(prisma.scene.update).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue({} as any);
      vi.mocked(callAIGM).mockResolvedValue(mockAIResponse);

      await expect(resolveScene(mockCampaignId, mockSceneId)).rejects.toThrow(/safety pause/i);

      // The AI-generated content must never reach the database or players.
      expect(applyWorldUpdates).not.toHaveBeenCalled();
      expect(prisma.scene.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sceneResolutionText: mockAIResponse.scene_text }) })
      );
      // Reverted back to AWAITING_ACTIONS so it can be retried once resumed
      // (resolveScene's own pre-call gate then blocks any retry attempt
      // until a GM actually resumes the scene, since isPaused stays true).
      expect(prisma.scene.update).toHaveBeenCalledWith({
        where: { id: mockSceneId },
        data: { status: 'AWAITING_ACTIONS' },
      });
    });

    it('should throw error if no player actions submitted', async () => {
      const sceneWithoutActions = { ...mockScene, playerActions: [] };
      vi.mocked(prisma.scene.findUnique).mockResolvedValue(sceneWithoutActions as any);

      await expect(resolveScene(mockCampaignId, mockSceneId)).rejects.toThrow(
        'No player actions submitted yet'
      );
    });

    it('should revert scene status on error', async () => {
      vi.mocked(prisma.scene.findUnique).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(mockScene as any);
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

      vi.mocked(prisma.scene.findUnique).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(prisma.worldMeta.update).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue(mockAIRequest as any);
      vi.mocked(callAIGM).mockResolvedValue(mockAIResponse);
      vi.mocked(applyWorldUpdates).mockResolvedValue({ involvedNpcIds: [], involvedFactionIds: [], unresolvedCharacterNames: [], worldChanges: [] });

      await resolveScene(mockCampaignId, mockSceneId);

      // isSceneEnding defaults to false and is threaded through to
      // buildSceneResolutionRequest as its 3rd arg (see scenePrompt.ts's
      // <scene_ending> section and end-scene/route.ts's forced-true call).
      expect(buildSceneResolutionRequest).toHaveBeenCalledWith(mockCampaignId, mockSceneId, false);
      // Phase 15: callAIGM also takes campaignId/sceneId (for cost tracking
      // and the circuit breaker) and a debug-mode flag, not just the request.
      expect(callAIGM).toHaveBeenCalledWith(mockAIRequest, mockCampaignId, mockSceneId, { debugMode: false });
    });

    // #101 v1.1: applyWorldUpdates' witnessCharacterIds param is derived from
    // the AI request's world_summary.characters, narrowed further to
    // characters who acted within the recent-activity window (see
    // sceneResolver.ts's RECENT_PRESENCE_EXCHANGE_WINDOW comment) — not just
    // the raw, scene-lifetime-append-only participant list.
    it('passes world_summary.characters as the WITNESSED roster, narrowed to recently active characters', async () => {
      const mockAIRequest = {
        campaign_id: mockCampaignId, scene_id: mockSceneId,
        world_summary: { characters: [{ id: 'char-a' }, { id: 'char-b' }] },
      };
      const witnessScene = {
        ...mockScene,
        currentExchange: 1,
        playerActions: [
          { id: 'action-a', characterId: 'char-a', exchangeNumber: 1, status: 'resolved' },
          { id: 'action-b', characterId: 'char-b', exchangeNumber: 0, status: 'resolved' },
        ],
      };

      vi.mocked(prisma.scene.findUnique).mockResolvedValue(witnessScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(witnessScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(prisma.worldMeta.update).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue(mockAIRequest as any);
      vi.mocked(callAIGM).mockResolvedValue(mockAIResponse);
      vi.mocked(applyWorldUpdates).mockResolvedValue({ involvedNpcIds: [], involvedFactionIds: [], unresolvedCharacterNames: [], worldChanges: [] });

      await resolveScene(mockCampaignId, mockSceneId);

      expect(applyWorldUpdates).toHaveBeenCalledWith(
        mockCampaignId, mockAIResponse, expect.anything(), true, expect.anything(), expect.anything(), ['char-a', 'char-b']
      );
    });

    it('excludes a world_summary character who last acted outside the recent-activity window', async () => {
      const mockAIRequest = {
        campaign_id: mockCampaignId, scene_id: mockSceneId,
        // char-c is a real scene participant (present in world_summary,
        // scopeCharactersToParticipants would include them) but hasn't
        // acted in a long time — the append-only-roster bug this fix closes.
        world_summary: { characters: [{ id: 'char-a' }, { id: 'char-c' }] },
      };
      const witnessScene = {
        ...mockScene,
        currentExchange: 10,
        playerActions: [
          { id: 'action-a', characterId: 'char-a', exchangeNumber: 10, status: 'resolved' },
          { id: 'action-c', characterId: 'char-c', exchangeNumber: 2, status: 'resolved' },
        ],
      };

      vi.mocked(prisma.scene.findUnique).mockResolvedValue(witnessScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(witnessScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(prisma.worldMeta.update).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue(mockAIRequest as any);
      vi.mocked(callAIGM).mockResolvedValue(mockAIResponse);
      vi.mocked(applyWorldUpdates).mockResolvedValue({ involvedNpcIds: [], involvedFactionIds: [], unresolvedCharacterNames: [], worldChanges: [] });

      await resolveScene(mockCampaignId, mockSceneId);

      expect(applyWorldUpdates).toHaveBeenCalledWith(
        mockCampaignId, mockAIResponse, expect.anything(), true, expect.anything(), expect.anything(), ['char-a']
      );
    });

    it('defaults the WITNESSED roster to empty when world_summary is missing (defensive, not just a test-mock convenience)', async () => {
      const mockAIRequest = { campaign_id: mockCampaignId, scene_id: mockSceneId };

      vi.mocked(prisma.scene.findUnique).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.scene.update).mockResolvedValue(mockScene as any);
      vi.mocked(prisma.worldMeta.findUnique).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(prisma.worldMeta.update).mockResolvedValue(mockWorldMeta as any);
      vi.mocked(buildSceneResolutionRequest).mockResolvedValue(mockAIRequest as any);
      vi.mocked(callAIGM).mockResolvedValue(mockAIResponse);
      vi.mocked(applyWorldUpdates).mockResolvedValue({ involvedNpcIds: [], involvedFactionIds: [], unresolvedCharacterNames: [], worldChanges: [] });

      await resolveScene(mockCampaignId, mockSceneId);

      expect(applyWorldUpdates).toHaveBeenCalledWith(
        mockCampaignId, mockAIResponse, expect.anything(), true, expect.anything(), expect.anything(), []
      );
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

      // scoped: true is what tells every downstream consumer (scene/route.ts,
      // the story page) this roster is a deliberate Character-Focused/
      // split-party restriction — not an open scene that merely has its
      // first joiner (see the matching checks in scene/route.ts).
      expect(prisma.scene.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          participants: { characterIds, userIds: ['user-1', 'user-2'], scoped: true },
        }),
      });
    });

    it('writes a generated stakes statement onto the new scene', async () => {
      const mockSceneIntro = 'A new adventure begins...';
      vi.mocked(prisma.scene.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.scene.create).mockResolvedValueOnce({ id: 'scene-1', sceneNumber: 1 } as any);
      vi.doMock('@/lib/ai/worldState', () => ({
        generateNewSceneIntro: vi.fn().mockResolvedValue(mockSceneIntro),
      }));
      vi.mocked(generateSceneStakes).mockResolvedValueOnce('The village starves if the granary is lost.');

      await createNewScene(mockCampaignId);

      expect(prisma.scene.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ stakes: 'The village starves if the granary is lost.' }),
      });
    });

    it('creates the scene with stakes: null when stakes generation fails/returns nothing', async () => {
      vi.mocked(prisma.scene.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.scene.create).mockResolvedValueOnce({ id: 'scene-1', sceneNumber: 1 } as any);
      vi.mocked(generateSceneStakes).mockRejectedValueOnce(new Error('stakes generation failed'));

      await expect(createNewScene(mockCampaignId)).resolves.toBeDefined();

      expect(prisma.scene.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ stakes: null }),
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

describe('isFirstSceneExchange', () => {
  // Gates map (re)generation to once per scene (see the 7.5 map step in
  // sceneResolver.ts) rather than once per exchange — a scene can resolve
  // several exchanges before the party moves on ("Keep scene active for
  // continuous play"), and existingResolutions is how the caller already
  // tracks whether any prior exchange has resolved yet.
  it('is true when there are no prior resolutions (a scene\'s first exchange)', () => {
    expect(isFirstSceneExchange([])).toBe(true);
  });

  it('is false once a scene has at least one prior resolution', () => {
    expect(isFirstSceneExchange(['The party entered the tavern.'])).toBe(false);
  });
});

describe('fallbackSummaryFromSceneText', () => {
  // Only exercised when the AI didn't report scene_summary (a repaired/
  // degraded response) — generateCampaignLog prefers the AI's own recap.
  it('takes the first three sentences, keeping their punctuation', () => {
    const text = 'Kairos drew his blade. The guard flinched. Imek shouted a warning. A fourth sentence nobody sees.';
    expect(fallbackSummaryFromSceneText(text)).toBe(
      'Kairos drew his blade. The guard flinched. Imek shouted a warning.'
    );
  });

  it('does not break mid-quote the way naive splitting on every punctuation mark did', () => {
    const text = '"Delvin says the chest has reached the eastern routes," Kairos said.';
    expect(fallbackSummaryFromSceneText(text)).toBe(
      '"Delvin says the chest has reached the eastern routes," Kairos said.'
    );
  });

  it('falls back to a character-limited slice when no sentence boundaries are found', () => {
    const text = 'a'.repeat(400);
    const result = fallbackSummaryFromSceneText(text);
    expect(result).toBe('a'.repeat(300) + '…');
  });

  it('does not append an ellipsis to short sentence-less text', () => {
    expect(fallbackSummaryFromSceneText('no punctuation here')).toBe('no punctuation here');
  });
});

describe('appendSummarySegment', () => {
  // A scene can resolve several exchanges before the party moves on - the
  // Story Log entry for it grows one segment per exchange instead of a
  // fresh near-duplicate row being created each time (see
  // generateCampaignLog's doc comment).
  it('appends the new segment to the existing summary', () => {
    expect(appendSummarySegment(
      'Kairos found a wounded runner in the Ratway.',
      'Imek recovered the map case as the ambush erupted.'
    )).toBe('Kairos found a wounded runner in the Ratway. Imek recovered the map case as the ambush erupted.');
  });

  it('starts fresh when there is no existing summary', () => {
    expect(appendSummarySegment('', 'The party entered the tavern.')).toBe('The party entered the tavern.');
  });

  it('drops the oldest complete sentences once the cap is exceeded, never mid-sentence', () => {
    const manySentences = Array.from({ length: 10 }, (_, i) => `Sentence ${i + 1} happened.`).join(' ');
    const result = appendSummarySegment(manySentences, 'Sentence 11 happened.');
    const sentences = result.match(/[^.!?]+[.!?]+/g) || [];
    expect(sentences).toHaveLength(10);
    expect(result.startsWith('Sentence 2 happened.')).toBe(true);
    expect(result.endsWith('Sentence 11 happened.')).toBe(true);
  });
});
