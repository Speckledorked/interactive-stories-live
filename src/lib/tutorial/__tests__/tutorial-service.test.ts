// src/lib/tutorial/__tests__/tutorial-service.test.ts
// #317/#318: completeStep and skipStep were both bare upserts with no
// server-side gate at all — any authenticated user who fetched the step
// list once could complete steps out of order, or skip a required one
// directly, entirely bypassing the ordering/optionality getNextStep's own
// (advisory-only) prerequisite check implied. This is the first test
// coverage this service has had.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TutorialStatus } from '@prisma/client'

const {
  stepFindUniqueMock, stepFindManyMock,
  progressFindManyMock, progressUpsertMock,
} = vi.hoisted(() => ({
  stepFindUniqueMock: vi.fn(),
  stepFindManyMock: vi.fn(),
  progressFindManyMock: vi.fn(),
  progressUpsertMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tutorialStep: {
      findUnique: stepFindUniqueMock,
      findMany: stepFindManyMock,
      // #411: reads now ensure the (global, upsert-seeded) step content
      // exists first — initializeTutorialSteps had zero callers, so
      // TutorialStep was never populated and every piece of machinery
      // around it tracked progress through an empty set.
      count: vi.fn().mockResolvedValue(1),
      upsert: vi.fn().mockResolvedValue({}),
    },
    userTutorialProgress: { findMany: progressFindManyMock, upsert: progressUpsertMock },
  },
}))

import { TutorialService } from '../tutorial-service'

beforeEach(() => {
  vi.clearAllMocks()
  progressUpsertMock.mockResolvedValue({ status: TutorialStatus.COMPLETED })
})

function step(overrides: Record<string, unknown> = {}) {
  return {
    id: 'step2',
    stepKey: 'create_character',
    isOptional: false,
    prerequisites: ['welcome'],
    ...overrides,
  }
}

describe('completeStep (#317)', () => {
  it('rejects completing a step that does not exist', async () => {
    stepFindUniqueMock.mockResolvedValue(null)
    await expect(TutorialService.completeStep('u1', 'ghost')).rejects.toThrow('Tutorial step not found')
    expect(progressUpsertMock).not.toHaveBeenCalled()
  })

  it('completes a step with no prerequisites without checking anything', async () => {
    stepFindUniqueMock.mockResolvedValue(step({ prerequisites: [] }))
    await TutorialService.completeStep('u1', 'step2')
    expect(progressFindManyMock).not.toHaveBeenCalled()
    expect(progressUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ status: TutorialStatus.COMPLETED }) })
    )
  })

  it('rejects completing a step whose prerequisite was never started', async () => {
    stepFindUniqueMock.mockResolvedValue(step({ prerequisites: ['welcome'] }))
    progressFindManyMock.mockResolvedValue([]) // no progress row for 'welcome' at all

    await expect(TutorialService.completeStep('u1', 'step2')).rejects.toThrow(
      'prerequisite step(s) not yet completed or skipped'
    )
    expect(progressUpsertMock).not.toHaveBeenCalled()
  })

  it('rejects completing a step whose prerequisite is only IN_PROGRESS', async () => {
    stepFindUniqueMock.mockResolvedValue(step({ prerequisites: ['welcome'] }))
    progressFindManyMock.mockResolvedValue([
      { status: TutorialStatus.IN_PROGRESS, step: { stepKey: 'welcome' } },
    ])

    await expect(TutorialService.completeStep('u1', 'step2')).rejects.toThrow('prerequisite')
    expect(progressUpsertMock).not.toHaveBeenCalled()
  })

  it('completes a step once its prerequisite is COMPLETED', async () => {
    stepFindUniqueMock.mockResolvedValue(step({ prerequisites: ['welcome'] }))
    progressFindManyMock.mockResolvedValue([
      { status: TutorialStatus.COMPLETED, step: { stepKey: 'welcome' } },
    ])

    await TutorialService.completeStep('u1', 'step2')
    expect(progressUpsertMock).toHaveBeenCalled()
  })

  // #318: SKIPPED satisfies a prerequisite exactly like COMPLETED does —
  // intentional (see the helper's own comment): once skipStep rejects
  // skipping a required step, only an optional step can ever be SKIPPED,
  // and it must still unblock what depends on it.
  it('completes a step whose prerequisite was SKIPPED, same as COMPLETED', async () => {
    stepFindUniqueMock.mockResolvedValue(step({ prerequisites: ['keyboard_shortcuts'] }))
    progressFindManyMock.mockResolvedValue([
      { status: TutorialStatus.SKIPPED, step: { stepKey: 'keyboard_shortcuts' } },
    ])

    await TutorialService.completeStep('u1', 'step2')
    expect(progressUpsertMock).toHaveBeenCalled()
  })

  it('rejects when only SOME of multiple prerequisites are satisfied', async () => {
    stepFindUniqueMock.mockResolvedValue(step({ prerequisites: ['welcome', 'create_character'] }))
    progressFindManyMock.mockResolvedValue([
      { status: TutorialStatus.COMPLETED, step: { stepKey: 'welcome' } },
      // 'create_character' has no row at all — not satisfied
    ])

    await expect(TutorialService.completeStep('u1', 'step2')).rejects.toThrow('prerequisite')
    expect(progressUpsertMock).not.toHaveBeenCalled()
  })
})

describe('skipStep (#318)', () => {
  it('rejects skipping a step that does not exist', async () => {
    stepFindUniqueMock.mockResolvedValue(null)
    await expect(TutorialService.skipStep('u1', 'ghost')).rejects.toThrow('Tutorial step not found')
    expect(progressUpsertMock).not.toHaveBeenCalled()
  })

  it('rejects skipping a required (non-optional) step', async () => {
    stepFindUniqueMock.mockResolvedValue({ isOptional: false, stepKey: 'create_character' })
    await expect(TutorialService.skipStep('u1', 'step2')).rejects.toThrow('it is a required step')
    expect(progressUpsertMock).not.toHaveBeenCalled()
  })

  it('allows skipping an optional step', async () => {
    stepFindUniqueMock.mockResolvedValue({ isOptional: true, stepKey: 'keyboard_shortcuts' })
    await TutorialService.skipStep('u1', 'step2')
    expect(progressUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ status: TutorialStatus.SKIPPED }) })
    )
  })
})

describe('handleTriggerEvent — auto-complete is best-effort around #317s new gate', () => {
  it('does not throw when an auto-triggered completion fails its prerequisite check', async () => {
    stepFindManyMock.mockResolvedValue([
      {
        id: 'step2',
        stepKey: 'create_character',
        prerequisites: ['welcome'],
        userProgress: [{ status: TutorialStatus.IN_PROGRESS }],
      },
    ])
    // completeStep's own lookup for this same step, called internally
    stepFindUniqueMock.mockResolvedValue(step({ prerequisites: ['welcome'] }))
    progressFindManyMock.mockResolvedValue([]) // prerequisite never satisfied

    await expect(
      TutorialService.handleTriggerEvent('u1', 'character_created')
    ).resolves.not.toThrow()
    expect(progressUpsertMock).not.toHaveBeenCalled()
  })

  it('completes the step when its prerequisites are actually satisfied', async () => {
    stepFindManyMock.mockResolvedValue([
      {
        id: 'step2',
        stepKey: 'create_character',
        prerequisites: [],
        userProgress: [{ status: TutorialStatus.IN_PROGRESS }],
      },
    ])
    stepFindUniqueMock.mockResolvedValue(step({ prerequisites: [] }))

    await TutorialService.handleTriggerEvent('u1', 'character_created')
    expect(progressUpsertMock).toHaveBeenCalled()
  })
})

describe('getNextStep — still finds the first eligible required step after the #317/#318 refactor', () => {
  it('skips a completed step and returns the next required one whose prerequisite is met', async () => {
    stepFindManyMock.mockResolvedValue([
      { id: 's1', stepKey: 'welcome', isOptional: false, prerequisites: [], userProgress: [{ status: TutorialStatus.COMPLETED }] },
      { id: 's2', stepKey: 'create_character', isOptional: false, prerequisites: ['welcome'], userProgress: [] },
    ])

    const next = await TutorialService.getNextStep('u1')
    expect(next?.stepKey).toBe('create_character')
  })

  it('does not return a required step whose prerequisite is unmet', async () => {
    stepFindManyMock.mockResolvedValue([
      { id: 's1', stepKey: 'welcome', isOptional: false, prerequisites: [], userProgress: [] },
      { id: 's2', stepKey: 'create_character', isOptional: false, prerequisites: ['welcome'], userProgress: [] },
    ])

    const next = await TutorialService.getNextStep('u1')
    expect(next?.stepKey).toBe('welcome')
  })

  it('returns null once every required step is complete', async () => {
    stepFindManyMock.mockResolvedValue([
      { id: 's1', stepKey: 'welcome', isOptional: false, prerequisites: [], userProgress: [{ status: TutorialStatus.COMPLETED }] },
    ])

    const next = await TutorialService.getNextStep('u1')
    expect(next).toBeNull()
  })
})
