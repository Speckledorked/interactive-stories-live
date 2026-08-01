// src/lib/lore/__tests__/loreImportService.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    loreImportJob: { update: vi.fn().mockResolvedValue(undefined) },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/ai/embeddingService', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.01)),
  embeddingToPostgresVector: vi.fn((embedding: number[]) => `[${embedding.join(',')}]`),
}))

vi.mock('../mediaWikiClient', () => ({
  detectApiBase: vi.fn(),
  listAllPages: vi.fn(),
  rankPagesByLength: vi.fn(),
  fetchExtracts: vi.fn(),
  fetchPageViaParse: vi.fn(),
  pageTitleFromUrl: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { generateEmbedding } from '@/lib/ai/embeddingService'
import { detectApiBase, listAllPages, rankPagesByLength, fetchExtracts, fetchPageViaParse, pageTitleFromUrl } from '../mediaWikiClient'
import { runLoreImport, WIKI_MAX_PAGES } from '../loreImportService'

function makeJob(overrides: Partial<any> = {}) {
  return {
    id: 'job-1',
    campaignId: 'campaign-1',
    sourceType: 'PASTE',
    sourceUrl: null,
    sourceTitle: null,
    rawText: null,
    status: 'RUNNING',
    attempts: 1,
    lastError: null,
    pagesFound: 0,
    pagesDone: 0,
    entriesCreated: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: new Date(),
    finishedAt: null,
    ...overrides,
  }
}

describe('runLoreImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Identity by default — most tests aren't exercising ranking itself,
    // just need the WIKI path to keep working with it in place.
    vi.mocked(rankPagesByLength).mockImplementation(async (_apiBase, candidates) => candidates)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('PASTE', () => {
    it('chunks and stores the pasted text, updating job progress', async () => {
      const job = makeJob({ sourceType: 'PASTE', rawText: 'A short piece of lore.', sourceTitle: 'My Lore' })
      await runLoreImport(job as any)

      expect(generateEmbedding).toHaveBeenCalledWith('A short piece of lore.')
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
      expect(prisma.loreImportJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { pagesFound: 1 },
      })
      expect(prisma.loreImportJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { pagesDone: 1, entriesCreated: { increment: 1 } },
      })
    })

    it('throws when there is no text', async () => {
      const job = makeJob({ sourceType: 'PASTE', rawText: '' })
      await expect(runLoreImport(job as any)).rejects.toThrow('No text to import')
    })
  })

  describe('URL', () => {
    it('fetches, extracts, chunks, and stores a single page', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<html><body><h1>Essence Magic</h1><p>Lore about essence.</p></body></html>',
      })
      vi.stubGlobal('fetch', fetchSpy)

      const job = makeJob({ sourceType: 'URL', sourceUrl: 'https://example.com/lore' })
      await runLoreImport(job as any)

      expect(fetchSpy).toHaveBeenCalledWith('https://example.com/lore', expect.any(Object))
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
      expect(prisma.loreImportJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { pagesDone: 1, entriesCreated: { increment: 1 } },
      })
    })

    it('throws on a failed fetch', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
      const job = makeJob({ sourceType: 'URL', sourceUrl: 'https://example.com/missing' })
      await expect(runLoreImport(job as any)).rejects.toThrow('Failed to fetch')
    })

    it('prefers the MediaWiki API when the URL points at a wiki page, never touching raw fetch', async () => {
      // Confirmed live: Fandom's Cloudflare protection 403s a direct page
      // fetch regardless of User-Agent, while api.php stays open — this is
      // the fix for that.
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      vi.mocked(detectApiBase).mockResolvedValue('https://example.fandom.com/api.php')
      vi.mocked(pageTitleFromUrl).mockReturnValue('Category:Characters')
      vi.mocked(fetchPageViaParse).mockResolvedValue('Full page text from the wiki API.')

      const job = makeJob({ sourceType: 'URL', sourceUrl: 'https://example.fandom.com/wiki/Category:Characters' })
      await runLoreImport(job as any)

      expect(fetchPageViaParse).toHaveBeenCalledWith('https://example.fandom.com/api.php', 'Category:Characters')
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    })

    it('falls back to raw fetch when the API path resolves but returns no content', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<html><body><h1>Fallback</h1><p>Fetched directly.</p></body></html>',
      })
      vi.stubGlobal('fetch', fetchSpy)
      vi.mocked(detectApiBase).mockResolvedValue('https://example.fandom.com/api.php')
      vi.mocked(pageTitleFromUrl).mockReturnValue('Some Page')
      vi.mocked(fetchPageViaParse).mockResolvedValue(null)

      const job = makeJob({ sourceType: 'URL', sourceUrl: 'https://example.fandom.com/wiki/Some_Page' })
      await runLoreImport(job as any)

      expect(fetchSpy).toHaveBeenCalledWith('https://example.fandom.com/wiki/Some_Page', expect.any(Object))
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    })

    it('falls back to raw fetch when the URL is not a MediaWiki site at all', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<html><body><h1>A Blog Post</h1><p>Not a wiki.</p></body></html>',
      })
      vi.stubGlobal('fetch', fetchSpy)
      vi.mocked(detectApiBase).mockResolvedValue(null)

      const job = makeJob({ sourceType: 'URL', sourceUrl: 'https://example.com/blog-post' })
      await runLoreImport(job as any)

      expect(fetchPageViaParse).not.toHaveBeenCalled()
      expect(fetchSpy).toHaveBeenCalledWith('https://example.com/blog-post', expect.any(Object))
    })
  })

  describe('WIKI', () => {
    it('crawls all pages via the MediaWiki API and stores each as chunks', async () => {
      vi.mocked(detectApiBase).mockResolvedValue('https://example.fandom.com/api.php')
      vi.mocked(listAllPages).mockResolvedValue([
        { pageId: 1, title: 'Essence Magic' },
        { pageId: 2, title: 'The Unbound' },
      ])
      vi.mocked(fetchExtracts).mockResolvedValue(new Map([
        ['Essence Magic', 'Magic drawn from world essence.'],
        ['The Unbound', 'A faction of rogue essence users.'],
      ]))

      const job = makeJob({ sourceType: 'WIKI', sourceUrl: 'https://example.fandom.com/wiki/Main_Page' })
      await runLoreImport(job as any)

      expect(prisma.loreImportJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { pagesFound: 2 },
      })
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2)
      expect(prisma.loreImportJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { pagesDone: { increment: 2 }, entriesCreated: { increment: 2 } },
      })
    })

    it('throws when the site is not a MediaWiki wiki', async () => {
      vi.mocked(detectApiBase).mockResolvedValue(null)
      const job = makeJob({ sourceType: 'WIKI', sourceUrl: 'https://example.com' })
      await expect(runLoreImport(job as any)).rejects.toThrow('does not look like a MediaWiki')
    })

    it('throws when no pages are found', async () => {
      vi.mocked(detectApiBase).mockResolvedValue('https://example.com/api.php')
      vi.mocked(listAllPages).mockResolvedValue([])
      const job = makeJob({ sourceType: 'WIKI', sourceUrl: 'https://example.com' })
      await expect(runLoreImport(job as any)).rejects.toThrow('No pages found')
    })

    it('skips pages with empty extracts without failing the job', async () => {
      vi.mocked(detectApiBase).mockResolvedValue('https://example.com/api.php')
      vi.mocked(listAllPages).mockResolvedValue([{ pageId: 1, title: 'Empty Page' }])
      vi.mocked(fetchExtracts).mockResolvedValue(new Map())

      const job = makeJob({ sourceType: 'WIKI', sourceUrl: 'https://example.com' })
      await expect(runLoreImport(job as any)).resolves.toBeUndefined()
      expect(prisma.$executeRaw).not.toHaveBeenCalled()
    })

    it('lists a larger candidate pool than WIKI_MAX_PAGES so ranking has real breadth to choose from', async () => {
      vi.mocked(detectApiBase).mockResolvedValue('https://example.com/api.php')
      vi.mocked(listAllPages).mockResolvedValue([{ pageId: 1, title: 'Essence Magic' }])
      vi.mocked(fetchExtracts).mockResolvedValue(new Map([['Essence Magic', 'Some lore.']]))

      const job = makeJob({ sourceType: 'WIKI', sourceUrl: 'https://example.com' })
      await runLoreImport(job as any)

      const [, maxPagesArg] = vi.mocked(listAllPages).mock.calls[0]
      expect(maxPagesArg).toBeGreaterThan(WIKI_MAX_PAGES)
    })

    it('ranks candidates by length and imports only the top WIKI_MAX_PAGES-worth', async () => {
      vi.mocked(detectApiBase).mockResolvedValue('https://example.com/api.php')
      const candidates = [
        { pageId: 1, title: 'Stub Page' },
        { pageId: 2, title: 'The Real Lore' },
      ]
      vi.mocked(listAllPages).mockResolvedValue(candidates)
      // Ranking reverses the alphabetical/discovery order — the substantial
      // page should end up imported first, the stub second.
      vi.mocked(rankPagesByLength).mockResolvedValue([candidates[1], candidates[0]])
      vi.mocked(fetchExtracts).mockResolvedValue(new Map([
        ['The Real Lore', 'Substantial lore content.'],
        ['Stub Page', 'Short.'],
      ]))

      const job = makeJob({ sourceType: 'WIKI', sourceUrl: 'https://example.com' })
      await runLoreImport(job as any)

      expect(rankPagesByLength).toHaveBeenCalledWith('https://example.com/api.php', candidates)
      expect(prisma.loreImportJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { pagesFound: 2 },
      })
    })

    it('falls back to the unranked (alphabetical) order if ranking itself throws, instead of failing the import', async () => {
      vi.mocked(detectApiBase).mockResolvedValue('https://example.com/api.php')
      vi.mocked(listAllPages).mockResolvedValue([{ pageId: 1, title: 'Essence Magic' }])
      vi.mocked(rankPagesByLength).mockRejectedValue(new Error('ranking API down'))
      vi.mocked(fetchExtracts).mockResolvedValue(new Map([['Essence Magic', 'Some lore.']]))

      const job = makeJob({ sourceType: 'WIKI', sourceUrl: 'https://example.com' })
      await expect(runLoreImport(job as any)).resolves.toBeUndefined()
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    })
  })

  it('throws for an unknown source type', async () => {
    const job = makeJob({ sourceType: 'BOGUS' })
    await expect(runLoreImport(job as any)).rejects.toThrow('Unknown lore source type')
  })
})
