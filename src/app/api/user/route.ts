// src/app/api/user/route.ts
// Get and update current user info
// GET /api/user - Get current user
// PATCH /api/user - Update user profile

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'

export async function GET(request: NextRequest) {
  try {
    const tokenUser = requireAuth(request)

    const user = await prisma.user.findUnique({
      where: { id: tokenUser.userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true
      }
    })

    if (!user) {
      return NextResponse.json<ErrorResponse>(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ user })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('Get user error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const tokenUser = requireAuth(request)
    const body = await request.json()

    // Only allow updating name for now
    const { name } = body

    if (name !== undefined && typeof name !== 'string') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Name must be a string' },
        { status: 400 }
      )
    }

    // Validate name length
    if (name && name.length > 100) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Name must be 100 characters or less' },
        { status: 400 }
      )
    }

    const user = await prisma.user.update({
      where: { id: tokenUser.userId },
      data: {
        name: name || null
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true
      }
    })

    return NextResponse.json({ user })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('Update user error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const tokenUser = requireAuth(request)
    const body = await request.json()

    // Require confirmation
    if (body.confirm !== 'DELETE MY ACCOUNT') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Confirmation required. Please type "DELETE MY ACCOUNT" to confirm.' },
        { status: 400 }
      )
    }

    // Delete user and all related data (cascading deletes handled by Prisma)
    await prisma.user.delete({
      where: { id: tokenUser.userId }
    })

    return NextResponse.json({ success: true, message: 'Account deleted successfully' })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('Delete user error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
