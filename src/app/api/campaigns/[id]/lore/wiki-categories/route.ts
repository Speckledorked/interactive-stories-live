// src/app/api/campaigns/[id]/lore/wiki-categories/route.ts
// Preview a wiki's real categories before starting a crawl, so the admin
// can pick some to exclude (e.g. "Characters") instead of typing names
// blind. Read-only and synchronous — no LoreImportJob is created here;
// this only calls the wiki's own API to list what it has.

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { detectApiBase, listCategories } from '@/lib/lore/mediaWikiClient'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can manage lore')
    if ('response' in adminCheck) return adminCheck.response

    const url = request.nextUrl.searchParams.get('url')?.trim()
    if (!url) {
      return NextResponse.json({ error: 'A wiki url query parameter is required' }, { status: 400 })
    }
    try {
      new URL(url)
    } catch {
      return NextResponse.json({ error: 'That is not a valid URL' }, { status: 400 })
    }

    const apiBase = await detectApiBase(url)
    if (!apiBase) {
      return NextResponse.json(
        { error: 'That URL does not look like a MediaWiki-based wiki (no api.php found)' },
        { status: 400 }
      )
    }

    const categories = await listCategories(apiBase)
    // Most-populous first — the categories worth knowing about (and most
    // likely to be worth excluding, like a large "Characters" category)
    // sort to the top instead of getting lost among one-page categories.
    categories.sort((a, b) => b.pageCount - a.pageCount)

    return NextResponse.json({ categories })
  } catch (error) {
    console.error('List wiki categories error:', error)
    return NextResponse.json({ error: 'Failed to read categories from that wiki' }, { status: 500 })
  }
}
