/**
 * Phase 14: Relationship Management System
 *
 * Hidden relationship tracking for Characters (trust, tension, respect, fear)
 * Players discover relationships through NPC behavior, NOT numbers
 */

import { PrismaClient, Character } from '@prisma/client';

export interface RelationshipValues {
  trust?: number;
  tension?: number;
  respect?: number;
  fear?: number;
}

export interface RelationshipMap {
  [entityId: string]: RelationshipValues;
}

/**
 * Adjust relationship values for a character with an entity (NPC, faction, or other character)
 * Values are clamped between -100 and 100
 */
export async function adjustRelationship(
  prisma: PrismaClient,
  characterId: string,
  entityId: string,
  delta: RelationshipValues
): Promise<RelationshipMap> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, relationships: true }
  });

  if (!character) {
    throw new Error(`Character ${characterId} not found`);
  }

  // Parse existing relationships
  const relationships: RelationshipMap = (character.relationships as RelationshipMap) || {};

  // Get or create relationship entry for this entity
  const currentRelationship: RelationshipValues = relationships[entityId] || {
    trust: 0,
    tension: 0,
    respect: 0,
    fear: 0
  };

  // Apply deltas and clamp values between -100 and 100
  const clamp = (value: number) => Math.max(-100, Math.min(100, value));

  const updatedRelationship: RelationshipValues = {
    trust: delta.trust !== undefined ? clamp((currentRelationship.trust || 0) + delta.trust) : currentRelationship.trust,
    tension: delta.tension !== undefined ? clamp((currentRelationship.tension || 0) + delta.tension) : currentRelationship.tension,
    respect: delta.respect !== undefined ? clamp((currentRelationship.respect || 0) + delta.respect) : currentRelationship.respect,
    fear: delta.fear !== undefined ? clamp((currentRelationship.fear || 0) + delta.fear) : currentRelationship.fear
  };

  // Update the relationships map
  relationships[entityId] = updatedRelationship;

  // Save back to database
  await prisma.character.update({
    where: { id: characterId },
    data: { relationships: relationships as any }
  });

  return relationships;
}

/**
 * Get a summary of all relationships for a character (GM-only view)
 * Returns formatted text describing relationship dynamics
 */
export async function summarizeRelationships(
  prisma: PrismaClient,
  characterId: string,
  entityNameMap?: { [entityId: string]: string }
): Promise<string> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      name: true,
      relationships: true
    }
  });

  if (!character) {
    throw new Error(`Character ${characterId} not found`);
  }

  const relationships: RelationshipMap = (character.relationships as RelationshipMap) || {};

  if (Object.keys(relationships).length === 0) {
    return `${character.name} has no established relationships yet.`;
  }

  const lines: string[] = [`## Relationships for ${character.name} (GM View - HIDDEN from players)\n`];

  for (const [entityId, values] of Object.entries(relationships)) {
    const entityName = entityNameMap?.[entityId] || `Entity ${entityId}`;
    const { trust = 0, tension = 0, respect = 0, fear = 0 } = values;

    lines.push(`### ${entityName}`);
    lines.push(`- Trust: ${formatValue(trust)}`);
    lines.push(`- Tension: ${formatValue(tension)}`);
    lines.push(`- Respect: ${formatValue(respect)}`);
    lines.push(`- Fear: ${formatValue(fear)}`);
    lines.push(`- Interpretation: ${interpretRelationship(values)}\n`);
  }

  return lines.join('\n');
}

/**
 * Format a relationship value for display
 */
function formatValue(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value}`;
}

/**
 * Interpret relationship values into natural language
 */
function interpretRelationship(values: RelationshipValues): string {
  const { trust = 0, tension = 0, respect = 0, fear = 0 } = values;

  const interpretations: string[] = [];

  // Trust interpretation
  if (trust > 50) interpretations.push('deeply trusted ally');
  else if (trust > 20) interpretations.push('trusted friend');
  else if (trust > 0) interpretations.push('cautiously trusted');
  else if (trust < -50) interpretations.push('completely distrusted');
  else if (trust < -20) interpretations.push('distrusted');
  else if (trust < 0) interpretations.push('slightly distrusted');

  // Tension interpretation
  if (tension > 50) interpretations.push('extreme tension');
  else if (tension > 20) interpretations.push('significant tension');
  else if (tension > 0) interpretations.push('some tension');

  // Respect interpretation
  if (respect > 50) interpretations.push('highly respected');
  else if (respect > 20) interpretations.push('respected');
  else if (respect < -50) interpretations.push('completely disrespected');
  else if (respect < -20) interpretations.push('disrespected');

  // Fear interpretation
  if (fear > 50) interpretations.push('deeply feared');
  else if (fear > 20) interpretations.push('feared');
  else if (fear > 0) interpretations.push('slightly intimidating');

  if (interpretations.length === 0) {
    return 'neutral relationship, no strong feelings';
  }

  return interpretations.join(', ');
}

/**
 * Get relationship values for use in AI prompts
 * Converts numeric values to narrative descriptions
 */
export function getRelationshipNarrative(
  relationships: RelationshipMap,
  entityId: string,
  entityName: string
): string | null {
  const relationship = relationships[entityId];
  if (!relationship) {
    return null;
  }

  const interpretation = interpretRelationship(relationship);
  return `${entityName}: ${interpretation}`;
}

/**
 * Phase 14.5: Validate relationship consistency
 * Reviews recent scenes to detect inconsistencies with relationship values
 */
export async function validateRelationshipConsistency(
  prisma: PrismaClient,
  characterId: string,
  recentSceneCount: number = 5
): Promise<{
  isConsistent: boolean;
  warnings: string[];
  personalityReminder?: string;
}> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      name: true,
      relationships: true,
      campaignId: true
    }
  });

  if (!character) {
    throw new Error(`Character ${characterId} not found`);
  }

  // Get recent scenes
  const recentScenes = await prisma.scene.findMany({
    where: { campaignId: character.campaignId },
    orderBy: { sceneNumber: 'desc' },
    take: recentSceneCount,
    select: {
      sceneResolutionText: true,
      consequences: true
    }
  });

  const warnings: string[] = [];
  const relationships: RelationshipMap = (character.relationships as RelationshipMap) || {};

  // Build personality reminder for AI
  const personalityReminders: string[] = [];
  for (const [entityId, values] of Object.entries(relationships)) {
    const interpretation = interpretRelationship(values);
    personalityReminders.push(`- Relationship dynamic: ${interpretation}`);
  }

  // Simple consistency check - in a full implementation, this would analyze scene text
  // For now, we just ensure the reminder is generated
  const personalityReminder = personalityReminders.length > 0
    ? `**Relationship Consistency Reminder:**\n${personalityReminders.join('\n')}\n\nNPCs must behave consistently with these relationship values.`
    : undefined;

  return {
    isConsistent: true, // Placeholder - full implementation would do text analysis
    warnings,
    personalityReminder
  };
}
