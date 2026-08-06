// src/app/api/campaigns/[id]/lore/wiki-categories/__tests__/route.test.ts
// #135 (cont.) — previewing a wiki's categories before a crawl had no
// test coverage: the admin-only gate, URL validation, the "not a
// MediaWiki site" case, and the most-populous-first sort, were all
// unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/lore/mediaWikiClient', () => ({
  detectApiBase: vi.fn(),
  listCategories: vi.fn(),
}))

import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { detectApiBase, listCategories } from '@/lib/lore/mediaWikiClient'
import { GET } from '../route'

function req(query = '') {
  return new NextRequest(`http://localhost/api/campaigns/camp1/lore/wiki-categories${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(req('?url=https://example.com/wiki'), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await GET(req('?url=https://example.com/wiki'), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('requires a url query param', async () => {
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('rejects a malformed URL', async () => {
    const response = await GET(req('?url=not-a-url'), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('rejects a URL with no detectable MediaWiki API', async () => {
    ;(detectApiBase as any).mockResolvedValue(null)
    const response = await GET(req('?url=https://example.com'), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(listCategories).not.toHaveBeenCalled()
  })

  it('sorts categories most-populous first', async () => {
    ;(detectApiBase as any).mockResolvedValue('https://example.com/api.php')
    ;(listCategories as any).mockResolvedValue([
      { name: 'Locations', pageCount: 3 },
      { name: 'Characters', pageCount: 50 },
    ])
    const response = await GET(req('?url=https://example.com/wiki'), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.categories[0].name).toBe('Characters')
    expect(body.categories[1].name).toBe('Locations')
  })

  it('returns 500 on an unexpected error', async () => {
    ;(detectApiBase as any).mockRejectedValue(new Error('network down'))
    const response = await GET(req('?url=https://example.com/wiki'), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
