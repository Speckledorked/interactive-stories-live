/**
 * Embedding Service
 *
 * Handles generation of vector embeddings for semantic search using OpenAI's API.
 * Used by the Campaign Memory RAG system to enable long-form history recall.
 */

import OpenAI from 'openai';
import { recordAICost, estimateTokenCount } from './cost-tracker';

// Lazily constructed so importing this module (even transitively, e.g. via
// createCampaignMemory) doesn't crash in environments without
// OPENAI_API_KEY set — matches the call-time key check every other AI
// integration in this codebase already uses (worldGenerator.ts,
// enrichStubNPCs, consequenceExtraction.ts, etc).
let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

const EMBEDDING_MODEL = 'text-embedding-ada-002';
const MAX_TEXT_LENGTH = 8000; // Safe token limit for ada-002

/**
 * Generate an embedding vector for text using OpenAI's ada-002 model
 *
 * @param text - The text to embed (will be truncated to 8000 chars)
 * @returns Array of 1536 numbers representing the embedding vector
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    // Truncate text to avoid token limits
    const truncatedText = text.slice(0, MAX_TEXT_LENGTH);

    const response = await getOpenAI().embeddings.create({
      model: EMBEDDING_MODEL,
      input: truncatedText,
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw new Error('Failed to generate embedding');
  }
}

/**
 * Convert embedding array to PostgreSQL vector format
 *
 * @param embedding - Array of numbers
 * @returns String in format "[1,2,3,...]" for PostgreSQL vector type
 */
export function embeddingToPostgresVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Generate an embedding for `text` and record its AI cost in one call —
 * the "start timer, embed, convert to pgvector format, recordAICost with
 * outputTokens: 0" sequence that used to be duplicated identically (bar
 * the requestType label) between memoryRetrieval.ts's
 * retrieveRelevantHistory and memoryCreation.ts's createCampaignMemory.
 * Fire-and-forget on the cost write, same as both original call sites —
 * a cost-tracking failure must never block scene resolution or memory
 * creation.
 *
 * @param campaignId - Campaign the cost is billed to
 * @param text - Text to embed
 * @param requestType - Cost-tracker request-type label (e.g. "memory_embedding")
 * @returns The embedding in PostgreSQL vector string format
 */
export async function embedWithCostTracking(
  campaignId: string,
  text: string,
  requestType: string
): Promise<string> {
  const startTime = Date.now();
  const embedding = await generateEmbedding(text);
  const embeddingString = embeddingToPostgresVector(embedding);

  await recordAICost({
    campaignId,
    model: EMBEDDING_MODEL,
    requestType,
    inputTokens: estimateTokenCount(text),
    outputTokens: 0,
    responseTimeMs: Date.now() - startTime,
    success: true
  }).catch(console.error);

  return embeddingString;
}

// generateEmbeddingsBatch, cosineSimilarity, estimateTokens, and
// estimateEmbeddingCost used to live here as never-called scaffolding —
// similarity math happens in pgvector SQL, and token/cost estimation lives
// in cost-tracker.ts. Removed; rebuild from git history if needed.
