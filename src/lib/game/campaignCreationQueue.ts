// src/lib/game/campaignCreationQueue.ts
//
// #493 — campaign creation stops being one opaque blocking request.
//
// It used to make five model calls (one for the world, then four in
// parallel) and seed a dozen tables, all inside the POST. The request ran
// past a minute routinely; the modal said "Building your world..." for all
// of it with no idea how far along it was; and a closed tab or a timed-out
// request lost the whole thing with nothing to resume. The hero image was
// already correctly made non-blocking — the other five calls were not.
//
// Deliberately the same shape as resolutionQueue.ts rather than a new
// mechanism: enqueue, kick a dedicated worker invocation, atomic
// PENDING→RUNNING claim, bounded retries, inline fallback if the kick is
// never delivered. That file's mechanics are already proven against the
// longest call in the product, and a second, subtly different job runner
// is a second set of ways to get stuck.
//
// One difference, and it is the point of the issue: a STAGE. Scene
// resolution is one opaque step that reports start and finish. Creation is
// five distinguishable ones, and which of them is running is exactly the
// information the modal was missing.
//
// What has NOT changed: the campaign still appears atomically. Everything
// is generated first and written in one transaction, so no reader ever sees
// a half-seeded campaign. Moving the work off the request does not mean
// moving the transaction.

import { prisma } from '@/lib/prisma'
import { kickInternalWorker } from '@/lib/jobs/kickInternalWorker'
import { getTemplate } from '@/lib/templates/campaign-templates'
import { createCampaign, type ValidatedLoreImport } from './campaignCreation'

/**
 * Two. Creation is expensive — five model calls, each billed — so a job
 * that fails twice stops rather than burning a third round on what is
 * probably a bad request or a provider outage. Scene resolution retries
 * more because its failures are far more often transient.
 */
const MAX_ATTEMPTS = 2

/** The request, as stored on the job and replayed by the worker. */
export interface CampaignCreationInput {
  title: string
  description?: string
  initialWorldSeed?: string
  resolvedUniverse: string
  resolvedSystemPrompt: string
  templateId: string | null
  validatedLore: ValidatedLoreImport | null
}

export type CreationStage = 'QUEUED' | 'WORLD' | 'DETAILS' | 'SEEDING' | 'DONE'

/**
 * What the modal shows for each stage. Here rather than in the component
 * because it is the job's vocabulary — a stage the UI has no sentence for
 * would render as nothing at all, which is the blankness this issue is
 * about.
 */
export const STAGE_LABELS: Record<CreationStage, string> = {
  QUEUED: 'Finding a quiet corner to work in…',
  WORLD: 'Drawing the map and deciding who holds it…',
  DETAILS: 'Setting the calendar, the customs and the rules…',
  SEEDING: 'Putting everyone where they belong…',
  DONE: 'Ready.',
}

export interface EnqueueResult {
  jobId: string
}

/** Create the job and hand it to its own invocation. */
export async function enqueueCampaignCreation(
  userId: string,
  input: CampaignCreationInput
): Promise<EnqueueResult> {
  const job = await prisma.campaignCreationJob.create({
    data: { userId, input: input as unknown as object },
  })
  await kickJob(job.id)
  return { jobId: job.id }
}

/**
 * See kickInternalWorker for the delivery mechanics. A non-OK response or a
 * failed delivery falls back to running the job inline, since either means
 * it was never handed off and its attempts counter never moved.
 */
export async function kickJob(jobId: string): Promise<void> {
  await kickInternalWorker('/api/internal/create-campaign', { jobId }, () =>
    processCampaignCreationJob(jobId)
  )
}

export interface ProcessResult {
  status: 'completed' | 'failed' | 'retry_scheduled' | 'skipped'
  campaignId?: string
  error?: string
}

/**
 * Run one creation job to completion. The PENDING→RUNNING claim is atomic,
 * so concurrent kicks and the inline fallback can all call this safely —
 * only one wins and the rest return 'skipped'.
 */
export async function processCampaignCreationJob(jobId: string): Promise<ProcessResult> {
  const claimed = await prisma.campaignCreationJob.updateMany({
    where: { id: jobId, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  })
  if (claimed.count === 0) return { status: 'skipped' }

  // The claim already flipped this row to RUNNING. Failing to read it back
  // must not strand it there — same reasoning as resolutionQueue's own
  // read-back guard.
  let job
  try {
    job = await prisma.campaignCreationJob.findUnique({ where: { id: jobId } })
  } catch (error) {
    console.error(`Failed to read back claimed creation job ${jobId}:`, error)
    await prisma.campaignCreationJob
      .update({ where: { id: jobId }, data: { status: 'PENDING' } })
      .catch((e) => console.error('Failed to revert stranded claim:', e))
    return { status: 'retry_scheduled', error: error instanceof Error ? error.message : String(error) }
  }
  if (!job) return { status: 'skipped' }

  const input = job.input as unknown as CampaignCreationInput

  try {
    const campaign = await createCampaign({
      title: input.title,
      description: input.description,
      initialWorldSeed: input.initialWorldSeed,
      resolvedUniverse: input.resolvedUniverse,
      resolvedSystemPrompt: input.resolvedSystemPrompt,
      // Resolved here rather than stored on the job: a template is code,
      // and serialising one into a row would freeze a copy that drifts from
      // the definition the rest of the product uses.
      template: input.templateId ? getTemplate(input.templateId) ?? null : null,
      validatedLore: input.validatedLore,
      userId: job.userId,
      onStage: async (stage) => {
        await prisma.campaignCreationJob.update({ where: { id: jobId }, data: { stage } })
      },
    })

    await prisma.campaignCreationJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        stage: 'DONE',
        campaignId: campaign.id,
        finishedAt: new Date(),
        lastError: null,
      },
    })
    console.log(`✅ Campaign creation job ${jobId} completed → ${campaign.id}`)
    return { status: 'completed', campaignId: campaign.id }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const retryable = job.attempts < MAX_ATTEMPTS
    await prisma.campaignCreationJob.update({
      where: { id: jobId },
      data: {
        status: retryable ? 'PENDING' : 'FAILED',
        lastError: message,
        ...(retryable ? {} : { finishedAt: new Date() }),
      },
    })
    console.error(`Campaign creation job ${jobId} failed (attempt ${job.attempts}):`, message)
    return { status: retryable ? 'retry_scheduled' : 'failed', error: message }
  }
}
