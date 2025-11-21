/**
 * Phase 14.6: AI Context Management
 *
 * Manages context window for long campaigns by:
 * - Compressing campaign history
 * - Extracting important moments
 * - Prioritizing recent vs important vs background info
 * - Managing scale for 100+ scene campaigns
 */

import { PrismaClient, Scene } from '@prisma/client';

export interface CompressedEvent {
  sceneNumber: number;
  title: string;
  summary: string;
  importance: 'critical' | 'important' | 'normal';
  relationshipChanges?: string[];
}

export interface RelationshipDigest {
  [characterId: string]: {
    characterName: string;
    keyRelationships: string[]; // Narrative summaries only
  };
}

export interface CampaignSummary {
  totalScenes: number;
  currentTurn: number;
  campaignPhase: string; // "beginning", "middle", "climax"
  keyEvents: CompressedEvent[];
  relationshipHighlights: string[];
  activeThreats: string[];
  completedGoals: string[];
}

export interface ContextStrategy {
  recentScenes: Scene[]; // Last 3 scenes (full detail)
  importantMoments: CompressedEvent[]; // Key events (summarized)
  relationshipSummary: RelationshipDigest;
  campaignSummary?: CampaignSummary;
}

/**
 * Generate a compressed campaign summary (every 10 scenes or on demand)
 */
export async function generateCampaignSummary(
  prisma: PrismaClient,
  campaignId: string
): Promise<CampaignSummary> {
  const [scenes, worldMeta, timeline, characters] = await Promise.all([
    prisma.scene.findMany({
      where: { campaignId, status: 'RESOLVED' },
      orderBy: { sceneNumber: 'asc' }
    }),
    prisma.worldMeta.findUnique({ where: { campaignId } }),
    prisma.timelineEvent.findMany({
      where: { campaignId },
      orderBy: { turnNumber: 'desc' },
      take: 20
    }),
    prisma.character.findMany({
      where: { campaignId, isAlive: true },
      select: { consequences: true }
    })
  ]);

  const totalScenes = scenes.length;

  // Determine campaign phase
  let campaignPhase: string;
  if (totalScenes < 10) campaignPhase = 'beginning';
  else if (totalScenes < 30) campaignPhase = 'middle';
  else campaignPhase = 'climax';

  // Extract important moments
  const keyEvents = await extractImportantMoments(scenes, timeline);

  // Extract active threats from consequences
  const activeThreats: string[] = [];
  characters.forEach(char => {
    const consequences = char.consequences as any;
    if (consequences?.enemies) {
      activeThreats.push(...consequences.enemies);
    }
    if (consequences?.longTermThreats) {
      activeThreats.push(...consequences.longTermThreats);
    }
  });

  return {
    totalScenes,
    currentTurn: worldMeta?.currentTurnNumber || 1,
    campaignPhase,
    keyEvents: keyEvents.slice(0, 10), // Top 10 most important
    relationshipHighlights: [],
    activeThreats: [...new Set(activeThreats)], // Deduplicate
    completedGoals: []
  };
}

/**
 * Extract important moments from scene history
 * Uses heuristics: character harm, major consequences, timeline event creation
 */
async function extractImportantMoments(
  scenes: Scene[],
  timeline: any[]
): Promise<CompressedEvent[]> {
  const importantMoments: CompressedEvent[] = [];

  for (const scene of scenes) {
    let importance: 'critical' | 'important' | 'normal' = 'normal';

    // Check if this scene created major timeline events
    const sceneEvents = timeline.filter(e => e.turnNumber === scene.sceneNumber);
    if (sceneEvents.length > 0 && sceneEvents.some(e => e.visibility === 'PUBLIC')) {
      importance = 'important';
    }

    // Check for major consequences in scene resolution
    const resolutionText = scene.sceneResolutionText?.toLowerCase() || '';
    const criticalKeywords = ['death', 'killed', 'betrayal', 'captured', 'victory', 'defeat', 'destroyed'];
    if (criticalKeywords.some(keyword => resolutionText.includes(keyword))) {
      importance = 'critical';
    }

    // Always include critical and important scenes
    if (importance !== 'normal') {
      importantMoments.push({
        sceneNumber: scene.sceneNumber,
        title: scene.title || `Scene ${scene.sceneNumber}`,
        summary: summarizeSceneText(scene.sceneResolutionText || ''),
        importance,
        relationshipChanges: extractRelationshipChangesFromScene(scene)
      });
    }
  }

  // Sort by importance and scene number
  return importantMoments.sort((a, b) => {
    const importanceOrder = { critical: 0, important: 1, normal: 2 };
    if (importanceOrder[a.importance] !== importanceOrder[b.importance]) {
      return importanceOrder[a.importance] - importanceOrder[b.importance];
    }
    return b.sceneNumber - a.sceneNumber; // More recent first within same importance
  });
}

/**
 * Summarize scene text to 1-2 sentences
 */
function summarizeSceneText(text: string): string {
  // Simple summarization: take first 200 chars
  if (text.length <= 200) return text;

  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length === 0) return text.substring(0, 200) + '...';

  // Try to fit 1-2 sentences within 200 chars
  let summary = sentences[0].trim();
  if (sentences.length > 1 && (summary.length + sentences[1].length) < 200) {
    summary += '. ' + sentences[1].trim();
  }

  return summary.length > 200 ? summary.substring(0, 197) + '...' : summary;
}

/**
 * Extract relationship changes mentioned in scene text
 */
function extractRelationshipChangesFromScene(scene: Scene): string[] {
  const changes: string[] = [];
  const consequences = scene.consequences as any;

  if (consequences?.relationshipChanges) {
    return consequences.relationshipChanges.map((rc: any) =>
      typeof rc === 'string' ? rc : rc.description || 'Relationship changed'
    );
  }

  return changes;
}

/**
 * Build optimized context for AI based on campaign size
 * Recent > Important > Background priority
 */
export async function buildOptimizedContext(
  prisma: PrismaClient,
  campaignId: string,
  currentSceneNumber: number
): Promise<ContextStrategy> {
  // Get recent scenes (full detail)
  const recentScenes = await prisma.scene.findMany({
    where: {
      campaignId,
      status: 'RESOLVED',
      sceneNumber: { lt: currentSceneNumber }
    },
    orderBy: { sceneNumber: 'desc' },
    take: 3 // Last 3 resolved scenes
  });

  // Get all resolved scenes for important moment extraction
  const allScenes = await prisma.scene.findMany({
    where: { campaignId, status: 'RESOLVED' },
    orderBy: { sceneNumber: 'asc' }
  });

  const timeline = await prisma.timelineEvent.findMany({
    where: { campaignId },
    orderBy: { turnNumber: 'desc' }
  });

  // Extract important moments (excluding recent scenes to avoid duplication)
  const importantMoments = await extractImportantMoments(
    allScenes.filter(s => s.sceneNumber < currentSceneNumber - 3),
    timeline
  );

  // Build relationship digest
  const characters = await prisma.character.findMany({
    where: { campaignId, isAlive: true },
    select: {
      id: true,
      name: true,
      relationships: true
    }
  });

  const relationshipSummary: RelationshipDigest = {};
  for (const char of characters) {
    const relationships = char.relationships as any;
    const keyRelationships: string[] = [];

    if (relationships && typeof relationships === 'object') {
      // Only include significant relationships (abs value > 30)
      for (const [entityId, values] of Object.entries(relationships)) {
        const relValues = values as any;
        const hasSignificantValue =
          Math.abs(relValues.trust || 0) > 30 ||
          Math.abs(relValues.tension || 0) > 30 ||
          Math.abs(relValues.respect || 0) > 30 ||
          Math.abs(relValues.fear || 0) > 30;

        if (hasSignificantValue) {
          keyRelationships.push(entityId); // Store entity ID for lookup
        }
      }
    }

    if (keyRelationships.length > 0) {
      relationshipSummary[char.id] = {
        characterName: char.name,
        keyRelationships
      };
    }
  }

  // Generate campaign summary if campaign is large (10+ scenes)
  let campaignSummary: CampaignSummary | undefined;
  if (allScenes.length >= 10) {
    campaignSummary = await generateCampaignSummary(prisma, campaignId);
  }

  return {
    recentScenes: recentScenes.reverse(), // Chronological order
    importantMoments: importantMoments.slice(0, 5), // Top 5 important moments
    relationshipSummary,
    campaignSummary
  };
}

/**
 * Monitor campaign health and scale
 * Warns if campaign is approaching limits
 */
export async function assessCampaignHealth(
  prisma: PrismaClient,
  campaignId: string
): Promise<{
  health: 'healthy' | 'warning' | 'critical';
  sceneCount: number;
  databaseSizeMB?: number;
  warnings: string[];
  recommendations: string[];
}> {
  const scenes = await prisma.scene.count({ where: { campaignId } });
  const characters = await prisma.character.count({ where: { campaignId } });
  const npcs = await prisma.nPC.count({ where: { campaignId } });
  const factions = await prisma.faction.count({ where: { campaignId } });

  const warnings: string[] = [];
  const recommendations: string[] = [];
  let health: 'healthy' | 'warning' | 'critical' = 'healthy';

  // Scene count warnings
  if (scenes > 100) {
    health = 'critical';
    warnings.push(`Campaign has ${scenes} scenes - approaching maximum manageable size`);
    recommendations.push('Consider starting a new campaign arc or season');
  } else if (scenes > 50) {
    health = 'warning';
    warnings.push(`Campaign has ${scenes} scenes - consider campaign summary review`);
    recommendations.push('Review and compress older scenes for better performance');
  }

  // Entity count warnings
  if (npcs > 50 || factions > 20) {
    warnings.push('Large number of NPCs/factions may impact context window');
    recommendations.push('Consider archiving inactive NPCs or factions');
  }

  if (characters > 8) {
    warnings.push(`${characters} player characters may cause complex scene resolution`);
    recommendations.push('Optimal player count is 3-5 characters');
  }

  return {
    health,
    sceneCount: scenes,
    warnings,
    recommendations
  };
}
