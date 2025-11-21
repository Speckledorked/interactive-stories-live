// src/lib/ai/response-cache.ts
// Phase 15.5: AI Response Caching

import { createHash } from 'crypto'

/**
 * Cache Entry
 */
interface CacheEntry {
  key: string
  response: any
  timestamp: number
  hits: number
  sceneContext: string
}

/**
 * AI Response Cache
 * Caches similar scenario responses to reduce AI costs and latency
 */
export class AIResponseCache {
  private cache: Map<string, CacheEntry> = new Map()
  private maxSize: number
  private ttlMs: number // Time to live in milliseconds

  constructor(maxSize: number = 100, ttlMinutes: number = 60) {
    this.maxSize = maxSize
    this.ttlMs = ttlMinutes * 60 * 1000
  }

  /**
   * Generate cache key from request
   * Uses hash of normalized request to match similar scenarios
   */
  private generateCacheKey(request: any): string {
    // Normalize request for caching
    const normalized = this.normalizeRequest(request)
    const serialized = JSON.stringify(normalized)
    return createHash('sha256').update(serialized).digest('hex').substring(0, 16)
  }

  /**
   * Normalize request to improve cache hit rate
   * Removes high-variability fields and normalizes similar content
   */
  private normalizeRequest(request: any): any {
    // Create a simplified version of the request that focuses on:
    // - Campaign universe
    // - Scene type
    // - Action patterns (not exact text)
    // - Current stakes

    return {
      universe: request.campaign_universe,
      actionCount: request.player_actions?.length || 0,
      actionPatterns: this.extractActionPatterns(request.player_actions || []),
      hasClocks: (request.world_summary?.clocks?.length || 0) > 0,
      hasFactions: (request.world_summary?.factions?.length || 0) > 0,
      sceneIntroLength: Math.floor((request.current_scene_intro?.length || 0) / 100)
    }
  }

  /**
   * Extract action patterns from player actions
   * Groups similar actions into patterns for better cache hits
   */
  private extractActionPatterns(actions: Array<{ action_text: string }>): string[] {
    const patterns: string[] = []

    for (const action of actions) {
      const text = action.action_text.toLowerCase()

      if (text.match(/\b(attack|fight|combat|strike)\b/)) {
        patterns.push('combat')
      } else if (text.match(/\b(talk|persuade|negotiate|convince)\b/)) {
        patterns.push('social')
      } else if (text.match(/\b(search|investigate|examine|look)\b/)) {
        patterns.push('investigate')
      } else if (text.match(/\b(move|go|run|walk|travel)\b/)) {
        patterns.push('movement')
      } else if (text.match(/\b(use|activate|cast|invoke)\b/)) {
        patterns.push('ability')
      } else {
        patterns.push('other')
      }
    }

    return [...new Set(patterns)].sort() // Unique and sorted
  }

  /**
   * Check if we have a cached response
   */
  get(request: any): any | null {
    const key = this.generateCacheKey(request)
    const entry = this.cache.get(key)

    if (!entry) {
      return null
    }

    // Check if entry has expired
    const age = Date.now() - entry.timestamp
    if (age > this.ttlMs) {
      this.cache.delete(key)
      console.log(`🗑️ Cache entry expired (age: ${Math.floor(age / 1000)}s)`)
      return null
    }

    // Update hit count
    entry.hits++
    console.log(`✅ Cache hit! (hits: ${entry.hits})`)

    return entry.response
  }

  /**
   * Store a response in cache
   */
  set(request: any, response: any, sceneContext: string = ''): void {
    const key = this.generateCacheKey(request)

    // Evict oldest entries if cache is full
    if (this.cache.size >= this.maxSize) {
      this.evictOldest()
    }

    const entry: CacheEntry = {
      key,
      response,
      timestamp: Date.now(),
      hits: 0,
      sceneContext
    }

    this.cache.set(key, entry)
    console.log(`💾 Cached AI response (cache size: ${this.cache.size})`)
  }

  /**
   * Evict oldest or least-used entries
   */
  private evictOldest(): void {
    // Find entry with lowest score (age + usage)
    let oldestKey: string | null = null
    let lowestScore = Infinity

    for (const [key, entry] of this.cache.entries()) {
      const age = Date.now() - entry.timestamp
      // Score: older entries + fewer hits = higher priority for eviction
      const score = age / (entry.hits + 1)

      if (score < lowestScore) {
        lowestScore = score
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
      console.log(`🗑️ Evicted cache entry (lowest score: ${lowestScore})`)
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear()
    console.log('🗑️ Cache cleared')
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number
    maxSize: number
    totalHits: number
    entries: Array<{ key: string; hits: number; age: number }>
  } {
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      hits: entry.hits,
      age: Math.floor((Date.now() - entry.timestamp) / 1000)
    }))

    const totalHits = entries.reduce((sum, e) => sum + e.hits, 0)

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      totalHits,
      entries
    }
  }

  /**
   * Pattern matching cache
   * For common scenarios, provide pre-generated templates
   */
  private static PATTERN_TEMPLATES: Record<string, any> = {
    'simple_combat': {
      // Template for basic combat scenarios
      patterns: ['combat'],
      template: {
        // Basic combat resolution structure
        harm_range: [1, 2],
        typical_conditions: ['Wounded', 'Stunned', 'Bleeding']
      }
    },
    'social_encounter': {
      patterns: ['social'],
      template: {
        // Social encounter structure
        relationship_changes_likely: true,
        harm_unlikely: true
      }
    }
  }

  /**
   * Check if request matches a known pattern
   */
  matchPattern(request: any): string | null {
    const patterns = this.extractActionPatterns(request.player_actions || [])

    for (const [patternName, patternDef] of Object.entries(AIResponseCache.PATTERN_TEMPLATES)) {
      const matches = patternDef.patterns.every((p: string) => patterns.includes(p))
      if (matches) {
        return patternName
      }
    }

    return null
  }
}

/**
 * Global cache instance
 */
export const aiResponseCache = new AIResponseCache(100, 60)
