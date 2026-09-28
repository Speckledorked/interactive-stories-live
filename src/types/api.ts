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
  // No token field: since the httpOnly-cookie migration, login/signup
  // deliver the session via Set-Cookie headers and the body carries the
  // user only. Returning a token to JavaScript would undo the httpOnly
  // protection (see src/lib/auth.ts).
  user: {
    id: string
    email: string
    name?: string | null
  }
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
