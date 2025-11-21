// src/lib/auth.ts
// Authentication helpers using JWT (JSON Web Tokens)
// Tokens are used to verify user identity without checking the database every time

import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'
import { headers } from 'next/headers'

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me'

// What we store inside the JWT token
export interface TokenPayload {
  userId: string
  email: string
}

/**
 * Create a JWT token for a user
 * @param payload - User info to encode
 * @returns JWT token string
 */
export function createToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '30d', // Token expires in 30 days
  })
}

/**
 * Verify and decode a JWT token
 * @param token - The JWT token to verify
 * @returns Decoded payload or null if invalid
 */
export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload
  } catch (error) {
    return null
  }
}

/**
 * Extract user info from the Authorization header
 * @param request - Next.js request object
 * @returns User info or null if not authenticated
 */
export function getUserFromRequest(request: NextRequest): TokenPayload | null {
  const authHeader = request.headers.get('authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7) // Remove "Bearer " prefix
  return verifyToken(token)
}

/**
 * Middleware helper to require authentication
 * Throws an error if user is not authenticated
 */
export function requireAuth(request: NextRequest): TokenPayload {
  const user = getUserFromRequest(request)

  if (!user) {
    throw new Error('Unauthorized')
  }

  return user
}

// -------------------------------------------
// Convenience helper used by API routes and server code
// Supports both getUser(request) and getUser()
// -------------------------------------------

export async function getUser(request?: NextRequest): Promise<TokenPayload | null> {
  // If an explicit NextRequest is passed (API routes), use it
  if (request) {
    return getUserFromRequest(request)
  }

  // Fallback: read from Next.js request headers in server components/actions
  try {
    const authHeader = headers().get('authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null
    }

    const token = authHeader.substring(7)
    return verifyToken(token)
  } catch {
    return null
  }
}

/**
 * Verify authentication and return user, or null if not authenticated
 * Used by API routes that need auth but want to handle unauthorized state themselves
 */
export async function verifyAuth(request: NextRequest): Promise<TokenPayload | null> {
  return getUserFromRequest(request)
}
