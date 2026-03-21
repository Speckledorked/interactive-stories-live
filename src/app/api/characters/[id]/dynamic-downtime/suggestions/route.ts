import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { AIDrivenDowntimeService } from '@/lib/downtime/ai-downtime-service'

// GET /api/characters/[id]/dynamic-downtime/suggestions
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await verifyAuth(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const suggestions = await AIDrivenDowntimeService.getPersonalizedSuggestions(params.id)
    return NextResponse.json({ suggestions })
  } catch (error) {
    console.error('Error fetching downtime suggestions:', error)
    return NextResponse.json({ error: 'Failed to fetch suggestions' }, { status: 500 })
  }
}
