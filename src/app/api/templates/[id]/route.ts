// src/app/api/templates/[id]/route.ts
// Get specific template details

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { getTemplate } from '@/lib/templates/campaign-templates'

/**
 * GET /api/templates/[id]
 * Get full template details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const template = getTemplate(params.id)

    if (!template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      template
    })
  } catch (error) {
    console.error('Error fetching template:', error)
    return NextResponse.json(
      { error: 'Failed to fetch template' },
      { status: 500 }
    )
  }
}
