// src/app/api/auth/verify-email/route.ts
// Email verification landing: the link in the verification email points
// here. Marks the account verified and bounces to the login page with a
// banner flag — no page of its own needed.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  const loginUrl = new URL('/login', request.nextUrl.origin)

  if (!token) {
    loginUrl.searchParams.set('verified', '0')
    return NextResponse.redirect(loginUrl)
  }

  try {
    const user = await prisma.user.findFirst({ where: { emailVerifyToken: token } })
    if (!user) {
      loginUrl.searchParams.set('verified', '0')
      return NextResponse.redirect(loginUrl)
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerifyToken: null },
    })
    loginUrl.searchParams.set('verified', '1')
    return NextResponse.redirect(loginUrl)
  } catch (error) {
    console.error('Email verification error:', error)
    loginUrl.searchParams.set('verified', '0')
    return NextResponse.redirect(loginUrl)
  }
}
