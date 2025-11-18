// src/types/api.ts
// Shared TypeScript types for API requests and responses

// ============================================
// AUTH
// ============================================

export interface SignupRequest {
  email: string
  password: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface AuthResponse {
  token: string
  user: {
    id: string
    email: string
  }
}

// ============================================
// CAMPAIGNS
// ============================================

export interface CreateCampaignRequest {
  title: string
  description: string
  universe: string
  aiSystemPrompt: string
  initialWorldSeed: string
}

export interface JoinCampaignRequest {
  campaignId: string
}

// ============================================
// CHARACTERS
// ============================================

export interface CreateCharacterRequest {
  campaignId: string
  name: string
  concept: string
  stats: Record<string, any>
  conditions: string[]
  currentLocation?: string
}

// ============================================
// PLAYER ACTIONS
// ============================================

export interface SubmitActionRequest {
  campaignId: string
  sceneId: string
  characterId: string
  actionText: string
}

// ============================================
// ERROR RESPONSE
// ============================================

export interface ErrorResponse {
  error: string
  details?: string
}
