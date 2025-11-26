/**
 * Embedding Service
 *
 * Handles generation of vector embeddings for semantic search using OpenAI's API.
 * Used by the Campaign Memory RAG system to enable long-form history recall.
 */

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

    const response = await openai.embeddings.create({
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
 * Batch generate embeddings for multiple texts
 *
 * @param texts - Array of texts to embed
 * @returns Array of embedding vectors (each 1536 numbers)
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  try {
    const truncatedTexts = texts.map(t => t.slice(0, MAX_TEXT_LENGTH));

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: truncatedTexts,
    });

    return response.data.map(d => d.embedding);
  } catch (error) {
    console.error('Error generating embeddings batch:', error);
    throw new Error('Failed to generate embeddings');
  }
}

/**
 * Calculate cosine similarity between two vectors
 * Used for in-memory similarity calculations
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Similarity score between 0 and 1 (1 = identical)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length');
  }

  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
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
 * Estimate token count for text (rough approximation)
 *
 * @param text - Text to estimate
 * @returns Approximate token count
 */
export function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/**
 * Calculate estimated cost for embeddings
 * ada-002 pricing: $0.0001 per 1K tokens
 *
 * @param textLength - Length of text in characters
 * @returns Estimated cost in USD
 */
export function estimateEmbeddingCost(textLength: number): number {
  const tokens = estimateTokens(textLength);
  return (tokens / 1000) * 0.0001;
}
