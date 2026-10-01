// src/lib/game/__tests__/campaignCreationQueue.test.ts
//
// #493 — creation as a job.
//
// The claim and the retry ceiling are the parts worth pinning. Creation is
// five billed model calls: a job that can be claimed twice bills twice, and
// a job that retries without limit bills forever. The stage callback is the
// other: it is the whole user-visible point of the change, and it is
// swallowed on failure, which is exactly the shape that stops working
// silently.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignCreationJob: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}))
vi.mock('@/lib/jobs/kickInternalWorker', () => ({ kickInternalWorker: vi.fn() }))
vi.mock('@/lib/templates/campaign-templates', () => ({ getTemplate: vi.fn() }))
vi.mock('../campaignCreation', () => ({ createCampaign: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { kickInternalWorker } from '@/lib/jobs/kickInternalWorker'
import { getTemplate } from '@/lib/templates/campaign-templates'
import { createCampaign } from '../campaignCreation'
import {
  enqueueCampaignCreation,
  processCampaignCreationJob,
  STAGE_LABELS,
} from '../campaignCreationQueue'

const db = prisma as any

const input = {
  title: 'Ashfall',
  description: 'A cold war over warmer ground',
  resolvedUniverse: 'Original',
  resolvedSystemPrompt: 'p',
  templateId: null,
  validatedLore: null,
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return { id: 'job1', userId: 'u1', input, attempts: 1, status: 'RUNNING', ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.campaignCreationJob.create.mockResolvedValue({ id: 'job1' })
  db.campaignCreationJob.updateMany.mockResolvedValue({ count: 1 })
  db.campaignCreationJob.findUnique.mockResolvedValue(jobRow())
  db.campaignCreationJob.update.mockResolvedValue({})
  ;(createCampaign as any).mockResolvedValue({ id: 'camp1' })
})

describe('enqueue', () => {
  it('stores the request and kicks its own invocation', async () => {
    const result = await enqueueCampaignCreation('u1', input)

    expect(result).toEqual({ jobId: 'job1' })
    expect(db.campaignCreationJob.create).toHaveBeenCalledWith({
      data: { userId: 'u1', input },
    })
    expect(kickInternalWorker).toHaveBeenCalledWith(
      '/api/internal/create-campaign',
      { jobId: 'job1' },
      expect.any(Function)
    )
  })

  it('falls back to running inline when the kick is never delivered', async () => {
    // A kick that was not delivered never incremented attempts, so the job
    // would otherwise sit PENDING with nothing coming for it.
    await enqueueCampaignCreation('u1', input)
    const fallback = (kickInternalWorker as any).mock.calls[0][2]

    await fallback()

    expect(db.campaignCreationJob.updateMany).toHaveBeenCalled()
  })
})

describe('the claim', () => {
  it('claims PENDING → RUNNING atomically', async () => {
    await processCampaignCreationJob('job1')

    expect(db.campaignCreationJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'RUNNING', attempts: { increment: 1 } }),
    })
  })

  it('does nothing at all when another caller already claimed it', async () => {
    // Five billed model calls. A second claim is a second bill.
    db.campaignCreationJob.updateMany.mockResolvedValue({ count: 0 })

    const result = await processCampaignCreationJob('job1')

    expect(result).toEqual({ status: 'skipped' })
    expect(createCampaign).not.toHaveBeenCalled()
  })

  it('un-strands a claimed row it then cannot read back', async () => {
    db.campaignCreationJob.findUnique.mockRejectedValue(new Error('db blip'))

    const result = await processCampaignCreationJob('job1')

    expect(result.status).toBe('retry_scheduled')
    expect(db.campaignCreationJob.update).toHaveBeenCalledWith({
      where: { id: 'job1' },
      data: { status: 'PENDING' },
    })
  })
})

describe('running the job', () => {
  it('records the campaign and finishes at DONE', async () => {
    const result = await processCampaignCreationJob('job1')

    expect(result).toEqual({ status: 'completed', campaignId: 'camp1' })
    expect(db.campaignCreationJob.update).toHaveBeenCalledWith({
      where: { id: 'job1' },
      data: expect.objectContaining({ status: 'COMPLETED', stage: 'DONE', campaignId: 'camp1' }),
    })
  })

  it('resolves the template from its id rather than the stored row', async () => {
    // A template is code. A serialised copy on the job row would drift from
    // the definition the rest of the product uses.
    db.campaignCreationJob.findUnique.mockResolvedValue(
      jobRow({ input: { ...input, templateId: 'tpl1' } })
    )
    ;(getTemplate as any).mockReturnValue({ id: 'tpl1', universe: 'Grim' })

    await processCampaignCreationJob('job1')

    expect(getTemplate).toHaveBeenCalledWith('tpl1')
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ template: { id: 'tpl1', universe: 'Grim' } })
    )
  })

  it('writes each stage as it begins', async () => {
    // The user-visible point of the whole change.
    ;(createCampaign as any).mockImplementation(async (args: any) => {
      await args.onStage('WORLD')
      await args.onStage('DETAILS')
      await args.onStage('SEEDING')
      return { id: 'camp1' }
    })

    await processCampaignCreationJob('job1')

    const stages = db.campaignCreationJob.update.mock.calls
      .map((c: any) => c[0].data.stage)
      .filter(Boolean)
    expect(stages).toEqual(['WORLD', 'DETAILS', 'SEEDING', 'DONE'])
  })
})

describe('failure', () => {
  it('returns to PENDING while an attempt remains', async () => {
    db.campaignCreationJob.findUnique.mockResolvedValue(jobRow({ attempts: 1 }))
    ;(createCampaign as any).mockRejectedValue(new Error('provider down'))

    const result = await processCampaignCreationJob('job1')

    expect(result.status).toBe('retry_scheduled')
    expect(db.campaignCreationJob.update).toHaveBeenCalledWith({
      where: { id: 'job1' },
      data: expect.objectContaining({ status: 'PENDING', lastError: 'provider down' }),
    })
  })

  it('gives up at the ceiling rather than billing a third round', async () => {
    db.campaignCreationJob.findUnique.mockResolvedValue(jobRow({ attempts: 2 }))
    ;(createCampaign as any).mockRejectedValue(new Error('provider down'))

    const result = await processCampaignCreationJob('job1')

    expect(result.status).toBe('failed')
    expect(db.campaignCreationJob.update).toHaveBeenCalledWith({
      where: { id: 'job1' },
      data: expect.objectContaining({ status: 'FAILED', finishedAt: expect.any(Date) }),
    })
  })
})

describe('the stage vocabulary', () => {
  it('has a sentence for every stage', () => {
    // A stage with no sentence renders as nothing at all, which is the
    // blankness this issue is about.
    for (const stage of ['QUEUED', 'WORLD', 'DETAILS', 'SEEDING', 'DONE'] as const) {
      expect(STAGE_LABELS[stage]).toBeTruthy()
    }
  })
})
