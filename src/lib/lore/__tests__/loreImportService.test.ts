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
  fetchExtracts: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { generateEmbedding } from '@/lib/ai/embeddingService'
import { detectApiBase, listAllPages, fetchExtracts } from '../mediaWikiClient'
import { runLoreImport } from '../loreImportService'

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
  })

  it('throws for an unknown source type', async () => {
    const job = makeJob({ sourceType: 'BOGUS' })
    await expect(runLoreImport(job as any)).rejects.toThrow('Unknown lore source type')
  })
})
