// src/app/api/user/route.ts
// Get and update current user info
// GET /api/user - Get current user
// PATCH /api/user - Update user profile

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { handleRouteError } from '@/lib/api/errors'
import { isTheme } from '@/lib/theme'

// Shared so GET and PATCH can't drift on what they expose.
const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  themePreference: true,
  // Null means "has never seen the orientation overlay" — the client
  // shows it on that basis. See the column comment in schema.prisma.
  orientationSeenAt: true,
  createdAt: true
} as const

export async function GET(request: NextRequest) {
  try {
    const tokenUser = await requireAuth(request)

    const user = await prisma.user.findUnique({
      where: { id: tokenUser.userId },
      select: USER_SELECT
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

    const { name, themePreference, orientationSeenAt } = body

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

    // Closed set, validated server-side — the column is a plain String, so
    // without this an arbitrary value could be stored and then read back
    // into a data-theme attribute.
    if (themePreference !== undefined && themePreference !== null && !isTheme(themePreference)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'themePreference must be one of: light, dark, system' },
        { status: 400 }
      )
    }

    // Boolean in, timestamp out. The client says WHETHER the orientation
    // has been seen; the server decides WHEN. Accepting a caller-supplied
    // date here would let a client write an arbitrary (or future, or
    // skewed) timestamp into a column whose whole purpose is answering
    // "has this person been shown the intro yet".
    //
    // `false` resets it to null, which re-arms the overlay — that's what
    // backs the "show me the intro again" control in settings.
    if (
      orientationSeenAt !== undefined &&
      typeof orientationSeenAt !== 'boolean'
    ) {
      return NextResponse.json<ErrorResponse>(
        { error: 'orientationSeenAt must be a boolean' },
        { status: 400 }
      )
    }

    // Build the update from only the keys actually present. This used to
    // be an unconditional `name: name || null`, which meant a PATCH
    // updating any OTHER field would silently clear the user's name — a
    // latent bug that only became reachable once this route accepted a
    // second field.
    const data: {
      name?: string | null
      themePreference?: string | null
      orientationSeenAt?: Date | null
    } = {}
    if (name !== undefined) data.name = name || null
    if (themePreference !== undefined) data.themePreference = themePreference
    if (orientationSeenAt !== undefined) {
      data.orientationSeenAt = orientationSeenAt ? new Date() : null
    }

    const user = await prisma.user.update({
      where: { id: tokenUser.userId },
      data,
      select: USER_SELECT
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
