/**
 * Memory Creation Service
 *
 * Creates campaign memories from resolved scenes and other game events.
 * Automatically generates embeddings and extracts metadata.
 */

import { prisma } from '@/lib/prisma';
import { embedWithCostTracking } from './embeddingService';
import type { Scene } from '@prisma/client';

// #284: a single bounded retry for a transient embedding-API failure
// before giving up — most embedding failures are exactly that (a rate
// limit, a momentary network blip), not a permanent rejection, and this
// runs in the post-tick tail where an extra half-second costs nothing a
// player would notice.
const EMBEDDING_RETRY_DELAY_MS = 500;

type MemoryType = 'SCENE' | 'NPC_INTERACTION' | 'FACTION_EVENT' | 'LOCATION_EVENT' | 'CHARACTER_MOMENT' | 'CLOCK_COMPLETION' | 'WORLD_EVENT';
type MemoryImportance = 'MINOR' | 'NORMAL' | 'MAJOR' | 'CRITICAL';

export interface MemoryData {
  campaignId: string;
  memoryType: MemoryType;
  sourceId: string;
  turnNumber: number;
  title: string;
  summary: string;
  fullContext: string;
  involvedCharacterIds: string[];
  involvedNpcIds: string[];
  involvedFactionIds: string[];
  locationTags: string[];
  importance: MemoryImportance;
  emotionalTone?: string;
  tags: string[];
  /**
   * #377: optional replay identity. Supply this from any caller that can
   * be re-run for the same logical event — the world turn is ~14 commit
   * boundaries, so a failure partway through re-runs the whole turn and
   * used to re-pay for every embedding it had already bought AND leave
   * duplicate rows competing in the RAG candidate pool.
   *
   * Omit it for genuinely one-shot writes; NULLs are distinct in a
   * Postgres unique index, so an absent key never collides with anything.
   */
  dedupeKey?: string;
}

/**
 * Build a stable replay key for a memory. Callers that can be replayed
 * should use this rather than inventing a format, so the shape stays
 * greppable and consistent across the four write paths.
 */
export function memoryDedupeKey(parts: {
  memoryType: MemoryType;
  sourceId: string;
  turnNumber: number;
  title: string;
}): string {
  return `${parts.memoryType}|${parts.sourceId}|${parts.turnNumber}|${parts.title}`;
}

/**
 * Create a campaign memory with semantic embedding
 *
 * Returns whether the write actually happened. Never throws — every
 * existing caller here already treated this as fire-and-forget (`await`ed
 * with the return value ignored), and that stays true; the return value
 * exists so a caller that DOES need to know (memoryConsolidation.ts's
 * create-then-delete loop, #216) can check it without this function's
 * own fail-open contract changing for anyone else.
 *
 * @param data - Memory data to store
 */
export async function createCampaignMemory(data: MemoryData): Promise<boolean> {
  try {
    // #377: check BEFORE embedding, not just at insert time. The ON
    // CONFLICT below is what actually guarantees uniqueness, but by then
    // the embedding call has already been made and billed — and the whole
    // reason a replayed world turn is expensive is those calls, not the
    // rows. One cheap indexed SELECT buys the saving.
    if (data.dedupeKey) {
      const existing = await prisma.campaignMemory.findFirst({
        where: { campaignId: data.campaignId, dedupeKey: data.dedupeKey },
        select: { id: true },
      });
      if (existing) {
        console.log(`↩️  Memory already recorded (${data.title}) — replay, no embedding purchased`);
        return true;
      }
    }

    // Generate embedding for the summary. One bounded retry: most
    // embedding failures are transient (a rate limit, a momentary network
    // blip), not permanent.
    let embeddingString: string;
    try {
      embeddingString = await embedWithCostTracking(data.campaignId, data.summary, 'memory_embedding');
    } catch (firstError) {
      console.error('Embedding call failed, retrying once:', firstError);
      await new Promise((resolve) => setTimeout(resolve, EMBEDDING_RETRY_DELAY_MS));
      embeddingString = await embedWithCostTracking(data.campaignId, data.summary, 'memory_embedding');
    }

    // Insert using raw SQL to handle vector type. Column names are quoted
    // and camelCase because that's what Prisma actually created the table
    // with (no @map on CampaignMemory's fields — only @@map on the table
    // itself) — unquoted snake_case identifiers here would silently target
    // nonexistent columns and fail against a real database.
    await prisma.$executeRaw`
      INSERT INTO campaign_memories (
        id,
        "campaignId",
        "memoryType",
        "sourceId",
        "turnNumber",
        title,
        summary,
        "fullContext",
        embedding,
        "involvedCharacterIds",
        "involvedNpcIds",
        "involvedFactionIds",
        "locationTags",
        importance,
        "emotionalTone",
        tags,
        "dedupeKey",
        "createdAt"
      ) VALUES (
        gen_random_uuid(),
        ${data.campaignId},
        ${data.memoryType}::\"MemoryType\",
        ${data.sourceId},
        ${data.turnNumber},
        ${data.title},
        ${data.summary},
        ${data.fullContext},
        ${embeddingString}::vector,
        ${data.involvedCharacterIds}::text[],
        ${data.involvedNpcIds}::text[],
        ${data.involvedFactionIds}::text[],
        ${data.locationTags}::text[],
        ${data.importance}::\"MemoryImportance\",
        ${data.emotionalTone},
        ${data.tags}::text[],
        ${data.dedupeKey ?? null},
        NOW()
      )
      -- #377: the pre-check above races against a concurrent identical
      -- write; this is what actually enforces uniqueness. NULL dedupeKeys
      -- are distinct in Postgres, so opted-out callers never conflict.
      ON CONFLICT ("campaignId", "dedupeKey") DO NOTHING
    `;

    console.log(`✓ Created memory: ${data.title} (${data.importance})`);
    return true;
  } catch (error) {
    console.error('Error creating campaign memory:', error);
    // Don't throw - we don't want memory creation to block scene resolution.
    // #284: this used to be silent past this point — a scene the party
    // actually experienced could vanish from campaign history with no
    // record it was ever attempted. Persist the full payload that failed
    // (not just an error string) so it's queryable and a future
    // retry/reader can recreate the memory exactly, not reconstruct it
    // from the original scene from scratch. Best-effort: if even this
    // write fails, there's nothing further to fall back to but the log.
    try {
      await prisma.memoryCreationFailure.create({
        data: {
          campaignId: data.campaignId,
          memoryType: data.memoryType,
          sourceId: data.sourceId,
          turnNumber: data.turnNumber,
          errorMessage: error instanceof Error ? error.message : String(error),
          data: data as object,
        },
      });
    } catch (recordError) {
      console.error('Failed to record memory creation failure:', recordError);
    }
    console.error('Failed to create memory, continuing without it');
    return false;
  }
}

/**
 * Create memory from a resolved scene
 *
 * This is the main entry point for automatic memory creation after scene resolution.
 *
 * @param scene - The resolved scene
 * @param worldMeta - World metadata (for turn number)
 * @param aiResponse - AI response containing world_updates
 * @param involvedEntities - NPC/Faction IDs actually resolved while applying
 *   this scene's world_updates (from applyWorldUpdates's return value) — the
 *   only reliable source of "which entities did this scene touch", since
 *   npc_changes/faction_changes reference entities by free-text name-or-id.
 */
export async function createSceneMemory(
  scene: Scene & { sceneResolutionText: string | null },
  worldMeta: { turnNumber: number },
  aiResponse: any,
  involvedEntities?: { npcIds: string[]; factionIds: string[] }
): Promise<void> {
  if (!scene.sceneResolutionText) {
    console.log('Scene has no resolution text, skipping memory creation');
    return;
  }

  try {
    // Prefer THIS exchange's newly-reported beats (scene_progress.
    // new_resolved_beats — real, deliberately atomic statements of what
    // just happened) over the old "first 3 sentences of raw prose"
    // heuristic, which just as often grabbed scene-setting description as
    // an actual plot beat. Deliberately the NEW beats only, not the whole
    // accumulated Scene.progressState ledger — this function runs once per
    // exchange, so summarizing the full running ledger every time would
    // make each later exchange's memory re-list everything all over again.
    // Falls back to the prose heuristic when nothing new was reported
    // (created before this existed, or a genuinely quiet exchange).
    const newBeats: string[] = (aiResponse?.scene_progress?.new_resolved_beats || [])
      .map((b: any) => (typeof b?.text === 'string' ? b.text : null))
      .filter((t: string | null): t is string => !!t);
    const summary = newBeats.length > 0
      ? newBeats.join('. ') + '.'
      : extractSummary(scene.sceneResolutionText);

    // Determine importance based on scene type and stakes
    const importance = determineImportance(scene, aiResponse);

    // Involved characters still come from scene.participants (set correctly
    // at scene creation). NPC/faction involvement is passed in explicitly now
    // — see the involvedEntities param doc above.
    const characterIds = ((scene.participants as any) || {}).characterIds || [];

    // Determine emotional tone
    const emotionalTone = detectEmotionalTone(scene.sceneResolutionText);

    // Extract tags
    const tags = extractTags(scene, aiResponse);

    await createCampaignMemory({
      campaignId: scene.campaignId,
      memoryType: 'SCENE',
      sourceId: scene.id,
      turnNumber: worldMeta.turnNumber,
      title: `Scene ${scene.sceneNumber}: ${extractTitle(scene)}`,
      summary,
      fullContext: scene.sceneResolutionText,
      involvedCharacterIds: characterIds,
      involvedNpcIds: involvedEntities?.npcIds || [],
      involvedFactionIds: involvedEntities?.factionIds || [],
      locationTags: scene.location ? [scene.location] : [],
      importance,
      emotionalTone,
      tags,
    });
  } catch (error) {
    console.error('Error creating scene memory:', error);
    // Don't throw - memory creation failures shouldn't block gameplay
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract a summary from scene resolution text (first 3 sentences)
 */
function extractSummary(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  const summary = sentences.slice(0, 3).join(' ').trim();

  // Fallback to first 300 chars if sentence detection fails
  if (!summary) {
    return text.slice(0, 300) + (text.length > 300 ? '...' : '');
  }

  return summary;
}

/**
 * Extract a title from the scene
 */
function extractTitle(scene: Scene): string {
  if (scene.title) return scene.title;

  // Extract first sentence or first 50 chars from intro
  const firstLine = scene.sceneIntroText?.split('\n')[0] || '';
  return firstLine.slice(0, 50) + (firstLine.length > 50 ? '...' : '');
}

/**
 * Determine memory importance based on scene content and AI updates.
 *
 * Reads the real `AIGMResponse.world_updates` shape (see lib/ai/client.ts) —
 * `pc_changes`/`clock_changes`/`faction_changes`/`new_timeline_events`. This
 * previously read `character_updates`/`clock_updates`/`faction_updates`/
 * `timeline_events`, none of which exist anywhere in that response: every
 * scene silently fell through to 'NORMAL' regardless of what actually
 * happened, with no error since the mismatch fails soft (`?.some` on
 * `undefined` is just `undefined`, which is falsy).
 */
export function determineImportance(scene: Scene, aiResponse: any): MemoryImportance {
  const updates = aiResponse?.world_updates || {};
  const pcChanges = updates.pc_changes || [];

  // CRITICAL: a character actually died, or took a severe hit
  if (
    pcChanges.some((u: any) =>
      u.changes?.death_save_result === 'failure' ||
      u.changes?.heroic_sacrifice ||
      (u.changes?.harm_damage ?? 0) >= 5
    ) ||
    updates.new_timeline_events?.some((e: any) =>
      e.title?.toLowerCase().includes('death') ||
      e.title?.toLowerCase().includes('destroyed')
    )
  ) {
    return 'CRITICAL';
  }

  // MAJOR: a clock advanced, a faction changed, or major combat
  if (
    (updates.clock_changes?.length ?? 0) > 0 ||
    (updates.faction_changes?.length ?? 0) > 0 ||
    scene.sceneType === 'combat'
  ) {
    return 'MAJOR';
  }

  // MINOR: downtime scenes with no notable timeline events
  if (scene.sceneType === 'downtime' && !(updates.new_timeline_events?.length)) {
    return 'MINOR';
  }

  return 'NORMAL';
}

/**
 * Detect emotional tone from text content
 */
function detectEmotionalTone(text: string): string | undefined {
  const lowerText = text.toLowerCase();

  const toneKeywords = [
    { tone: 'triumphant', keywords: ['triumph', 'victory', 'succeed', 'prevail'] },
    { tone: 'tense', keywords: ['tense', 'suspense', 'anxious', 'nervous', 'edge'] },
    { tone: 'tragic', keywords: ['tragic', 'loss', 'grief', 'sorrow', 'devastat'] },
    { tone: 'mysterious', keywords: ['mysterious', 'ominous', 'strange', 'eerie', 'uncanny'] },
    { tone: 'peaceful', keywords: ['peaceful', 'calm', 'serene', 'tranquil', 'gentle'] },
    { tone: 'chaotic', keywords: ['chaos', 'frantic', 'mayhem', 'pandemonium'] },
    { tone: 'hopeful', keywords: ['hope', 'optimis', 'bright', 'promise'] },
    { tone: 'dark', keywords: ['dark', 'grim', 'bleak', 'dire', 'foreboding'] },
  ];

  for (const { tone, keywords } of toneKeywords) {
    if (keywords.some(keyword => lowerText.includes(keyword))) {
      return tone;
    }
  }

  return undefined;
}

/**
 * Extract tags from scene content and updates.
 *
 * Same field-name fix as determineImportance() above — the
 * `pc_changes`/`clock_changes` checks below previously read
 * `character_updates`/`clock_updates`, which don't exist on
 * `world_updates`, so the relationships/consequences/clock_progression
 * tags could never fire.
 */
export function extractTags(scene: Scene, aiResponse: any): string[] {
  const tags: string[] = [];
  const updates = aiResponse?.world_updates || {};
  const pcChanges = updates.pc_changes || [];

  // Scene type
  if (scene.sceneType) {
    tags.push(scene.sceneType);
  }

  const text = scene.sceneResolutionText?.toLowerCase() || '';

  // Combat tags
  if (text.includes('attack') || text.includes('fight') || text.includes('combat') || text.includes('battle')) {
    tags.push('combat');
  }

  // Social tags
  if (text.includes('negotiate') || text.includes('persuade') || text.includes('deceive') || text.includes('convince')) {
    tags.push('social');
  }

  // Investigation tags
  if (text.includes('investigate') || text.includes('search') || text.includes('discover') || text.includes('find')) {
    tags.push('investigation');
  }

  // Stealth tags
  if (text.includes('sneak') || text.includes('hide') || text.includes('stealth') || text.includes('infiltrate')) {
    tags.push('stealth');
  }

  // Magic tags
  if (text.includes('magic') || text.includes('spell') || text.includes('ritual') || text.includes('enchant')) {
    tags.push('magic');
  }

  // Relationship tags
  if (pcChanges.some((u: any) => u.changes?.relationship_changes?.length > 0)) {
    tags.push('relationships');
  }

  // Consequences tags
  if (pcChanges.some((u: any) => u.changes?.consequences_add?.length > 0 || u.changes?.consequences_remove?.length > 0)) {
    tags.push('consequences');
  }

  // Clock progression tags
  if ((updates.clock_changes?.length ?? 0) > 0) {
    tags.push('clock_progression');
  }

  return Array.from(new Set(tags)); // Remove duplicates
}

// createClockCompletionMemory and createNpcInteractionMemory used to live
// here as speculative wrappers around createCampaignMemory; neither ever
// gained a caller (clock completions and NPC interactions reach memory
// through logSignificantChanges / createSceneMemory instead) and both were
// removed. Rebuild from git history if a direct-call use case appears.
