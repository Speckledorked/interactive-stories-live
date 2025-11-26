/**
 * Memory Creation Service
 *
 * Creates campaign memories from resolved scenes and other game events.
 * Automatically generates embeddings and extracts metadata.
 */

import { prisma } from '@/lib/prisma';
import { generateEmbedding, embeddingToPostgresVector } from './embeddingService';
import type { Scene } from '@prisma/client';

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
}

/**
 * Create a campaign memory with semantic embedding
 *
 * @param data - Memory data to store
 */
export async function createCampaignMemory(data: MemoryData): Promise<void> {
  try {
    // Generate embedding for the summary
    const embedding = await generateEmbedding(data.summary);
    const embeddingString = embeddingToPostgresVector(embedding);

    // Insert using raw SQL to handle vector type
    await prisma.$executeRaw`
      INSERT INTO campaign_memories (
        id,
        campaign_id,
        memory_type,
        source_id,
        turn_number,
        title,
        summary,
        full_context,
        embedding,
        involved_character_ids,
        involved_npc_ids,
        involved_faction_ids,
        location_tags,
        importance,
        emotional_tone,
        tags,
        created_at
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
        NOW()
      )
    `;

    console.log(`✓ Created memory: ${data.title} (${data.importance})`);
  } catch (error) {
    console.error('Error creating campaign memory:', error);
    // Don't throw - we don't want memory creation to block scene resolution
    console.error('Failed to create memory, continuing without it');
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
 */
export async function createSceneMemory(
  scene: Scene & { sceneResolutionText: string | null },
  worldMeta: { turnNumber: number },
  aiResponse: any
): Promise<void> {
  if (!scene.sceneResolutionText) {
    console.log('Scene has no resolution text, skipping memory creation');
    return;
  }

  try {
    // Extract summary (first 3-4 sentences)
    const summary = extractSummary(scene.sceneResolutionText);

    // Determine importance based on scene type and stakes
    const importance = determineImportance(scene, aiResponse);

    // Extract involved entities
    const involvedEntities = extractInvolvedEntities(scene, aiResponse);

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
      involvedCharacterIds: involvedEntities.characterIds,
      involvedNpcIds: involvedEntities.npcIds,
      involvedFactionIds: involvedEntities.factionIds,
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
 * Determine memory importance based on scene content and AI updates
 */
function determineImportance(scene: Scene, aiResponse: any): MemoryImportance {
  const updates = aiResponse?.world_updates || {};

  // CRITICAL: Major character death, campaign-changing event
  if (
    updates.character_updates?.some((u: any) => u.harm >= 5) ||
    updates.timeline_events?.some((e: any) =>
      e.title?.toLowerCase().includes('death') ||
      e.title?.toLowerCase().includes('destroyed') ||
      e.visibility === 'CRITICAL'
    )
  ) {
    return 'CRITICAL';
  }

  // MAJOR: Significant faction changes, clock completions, major combat
  if (
    updates.clock_updates?.some((c: any) => {
      const isComplete = c.ticks_to_add && (c.new_ticks >= c.max_ticks || c.current_ticks >= c.max_ticks);
      return isComplete;
    }) ||
    updates.faction_updates?.length > 0 ||
    scene.sceneType === 'combat'
  ) {
    return 'MAJOR';
  }

  // MINOR: Downtime scenes with no major consequences
  if (scene.sceneType === 'downtime' && !updates.timeline_events?.length) {
    return 'MINOR';
  }

  return 'NORMAL';
}

/**
 * Extract IDs of entities involved in the scene
 */
function extractInvolvedEntities(scene: Scene, aiResponse: any): {
  characterIds: string[];
  npcIds: string[];
  factionIds: string[];
} {
  const participants = (scene.participants as any) || {};
  const updates = aiResponse?.world_updates || {};

  // Get unique NPC IDs from participants and updates
  const npcIds = new Set<string>([
    ...(participants.npcIds || []),
    ...(updates.npc_updates?.map((u: any) => u.npc_id) || []),
  ]);

  // Get unique faction IDs from updates
  const factionIds = new Set<string>(
    updates.faction_updates?.map((u: any) => u.faction_id) || []
  );

  return {
    characterIds: participants.characterIds || [],
    npcIds: Array.from(npcIds),
    factionIds: Array.from(factionIds),
  };
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
 * Extract tags from scene content and updates
 */
function extractTags(scene: Scene, aiResponse: any): string[] {
  const tags: string[] = [];
  const updates = aiResponse?.world_updates || {};

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
  if (updates.character_updates?.some((u: any) => u.relationship_changes?.length > 0)) {
    tags.push('relationships');
  }

  // Consequences tags
  if (updates.character_updates?.some((u: any) => u.consequences)) {
    tags.push('consequences');
  }

  // Clock progression tags
  if (updates.clock_updates?.length > 0) {
    tags.push('clock_progression');
  }

  return Array.from(new Set(tags)); // Remove duplicates
}

/**
 * Create a memory for a clock completion event
 */
export async function createClockCompletionMemory(
  campaignId: string,
  clockId: string,
  clockName: string,
  consequence: string,
  turnNumber: number,
  involvedEntities: {
    characterIds?: string[];
    npcIds?: string[];
    factionIds?: string[];
  } = {}
): Promise<void> {
  await createCampaignMemory({
    campaignId,
    memoryType: 'CLOCK_COMPLETION',
    sourceId: clockId,
    turnNumber,
    title: `Clock Completed: ${clockName}`,
    summary: `The "${clockName}" clock has filled completely. ${consequence || 'The consequences unfold.'}`,
    fullContext: consequence || 'Clock completed without specified consequences.',
    involvedCharacterIds: involvedEntities.characterIds || [],
    involvedNpcIds: involvedEntities.npcIds || [],
    involvedFactionIds: involvedEntities.factionIds || [],
    locationTags: [],
    importance: 'MAJOR',
    emotionalTone: undefined,
    tags: ['clock_completion', 'milestone'],
  });
}

/**
 * Create a memory for a significant NPC interaction
 */
export async function createNpcInteractionMemory(
  campaignId: string,
  npcId: string,
  npcName: string,
  interactionSummary: string,
  turnNumber: number,
  characterIds: string[],
  importance: MemoryImportance = 'NORMAL'
): Promise<void> {
  await createCampaignMemory({
    campaignId,
    memoryType: 'NPC_INTERACTION',
    sourceId: npcId,
    turnNumber,
    title: `Interaction with ${npcName}`,
    summary: interactionSummary,
    fullContext: interactionSummary,
    involvedCharacterIds: characterIds,
    involvedNpcIds: [npcId],
    involvedFactionIds: [],
    locationTags: [],
    importance,
    emotionalTone: detectEmotionalTone(interactionSummary),
    tags: ['npc_interaction', 'social'],
  });
}
