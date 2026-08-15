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
    name?: string | null
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
// TUTORIAL
// ============================================

// #308: GET /api/tutorial/progress and /tutorial/page.tsx drifted apart on
// the response's field name (the route returns `progress`, the page read
// `data.steps`) with nothing forcing them to agree — this shared type is
// what both sides now import instead of each hand-writing their own shape.
export interface TutorialStepProgress {
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED'
  completedAt?: string | Date | null
  skippedAt?: string | Date | null
}

export interface TutorialStepWithProgress {
  id: string
  stepKey: string
  title: string
  description: string
  category: string
  orderIndex: number
  isOptional: boolean
  userProgress: TutorialStepProgress | null
}

export interface TutorialProgressResponse {
  progress: TutorialStepWithProgress[]
  nextStep: TutorialStepWithProgress | null
  completionPercentage: number
}

// ============================================
// ERROR RESPONSE
// ============================================

export interface ErrorResponse {
  error: string
  details?: string
}
