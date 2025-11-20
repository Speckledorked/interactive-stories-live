// force deploy
// src/app/api/auth/login/route.ts
// User login endpoint
// Verifies credentials and returns a JWT token

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/password'
import { createToken } from '@/lib/auth'
import { LoginRequest, AuthResponse, ErrorResponse } from '@/types/api'

export async function POST(request: NextRequest) {
  try {
    const body: LoginRequest = await request.json()
    const { email, password } = body

    // Validate input
    if (!email || !password) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email }
    })

    // Updated null-check to reference: user.password
    if (!user || !user.password) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Verify password (updated: use user.password)
    const isValid = await verifyPassword(password, user.password)

    if (!isValid) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Create JWT token
    const token = createToken({
      userId: user.id,
      email: user.email
    })

    // Return token and user info
    return NextResponse.json<AuthResponse>({
      token,
      user: {
        id: user.id,
        email: user.email
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
