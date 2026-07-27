// src/app/api/user/route.ts
// Get and update current user info
// GET /api/user - Get current user
// PATCH /api/user - Update user profile

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { handleRouteError } from '@/lib/api/errors'

export async function GET(request: NextRequest) {
  try {
    const tokenUser = await requireAuth(request)

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
    return handleRouteError(error, 'Get user error', 'Internal server error')
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const tokenUser = await requireAuth(request)
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
    return handleRouteError(error, 'Update user error', 'Internal server error')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const tokenUser = await requireAuth(request)
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
    return handleRouteError(error, 'Delete user error', 'Internal server error')
  }
}
