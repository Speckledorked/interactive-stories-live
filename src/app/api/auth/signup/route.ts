// src/app/api/auth/signup/route.ts
// User signup endpoint
// Creates a new user account with hashed password

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/password'
import { createToken } from '@/lib/auth'
import { SignupRequest, AuthResponse, ErrorResponse } from '@/types/api'
import { recordEvent } from '@/lib/analytics/events'

export async function POST(request: NextRequest) {
  try {
    const body: SignupRequest = await request.json()
    const { email, password } = body

    // Validate input
    if (!email || !password) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      return NextResponse.json<ErrorResponse>(
        { error: 'User already exists with this email' },
        { status: 409 }
      )
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password)

    const emailVerifyToken = crypto.randomUUID()
    const user = await prisma.user.create({
      data: {
        email,
        password: passwordHash, // store hashed password in `password` column
        emailVerifyToken,
      },
    })

    // Best-effort verification email — signup must not fail because SMTP
    // did. Unverified accounts still work (soft verification); the flag
    // exists so features can gate on it later.
    try {
      const { EmailService } = await import('@/lib/notifications/email-service')
      await EmailService.sendVerificationEmail(email, emailVerifyToken)
    } catch (emailError) {
      console.error('Verification email failed (non-critical):', emailError)
    }

    await recordEvent('SIGNUP', { userId: user.id })

    // Create JWT token
    const token = createToken({
      userId: user.id,
      email: user.email
    })

    // Return token and user info
    return NextResponse.json<AuthResponse>(
      {
        token,
        user: {
          id: user.id,
          email: user.email
        }
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Signup error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
