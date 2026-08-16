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
  stepFindUniqueMock, stepFindManyMock, stepCountMock, stepUpsertMock,
  progressFindManyMock, progressUpsertMock,
} = vi.hoisted(() => ({
  stepFindUniqueMock: vi.fn(),
  stepFindManyMock: vi.fn(),
  stepCountMock: vi.fn(),
  stepUpsertMock: vi.fn(),
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
      count: stepCountMock,
      upsert: stepUpsertMock,
    },
    userTutorialProgress: { findMany: progressFindManyMock, upsert: progressUpsertMock },
  },
}))

import { TutorialService } from '../tutorial-service'

beforeEach(() => {
  vi.clearAllMocks()
  progressUpsertMock.mockResolvedValue({ status: TutorialStatus.COMPLETED })
  stepCountMock.mockResolvedValue(1)
  stepUpsertMock.mockResolvedValue({})
  stepFindManyMock.mockResolvedValue([])
  progressFindManyMock.mockResolvedValue([])
  // #411: the seeded-once flag is process-wide by design (see
  // ensureTutorialSteps). Reset between tests so each one starts from a
  // cold process rather than inheriting whatever the previous test left.
  ;(TutorialService as unknown as { stepsSeeded: boolean }).stepsSeeded = false
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


describe('ensureTutorialSteps (#411)', () => {
  // The defect this guards was not a broken function — it was a function
  // with ZERO CALLERS. `initializeTutorialSteps` held the only copy of the
  // tutorial's content and nothing ever ran it, so `TutorialStep` stayed
  // empty and every piece of machinery around it (persisted completion
  // tracking, prerequisites, the gates, the components) tracked progress
  // through an empty set.
  //
  // That is precisely the shape a test suite misses by default: nothing
  // FAILS when content is absent, the tutorial just quietly has nothing in
  // it. So what these assert is the wiring itself — that the read paths
  // reach the seeder at all. Without them, deleting `ensureTutorialSteps`
  // outright would leave this suite green, which is the state #411 was
  // filed about in the first place.

  it('seeds the step content when the table is empty', async () => {
    stepCountMock.mockResolvedValue(0)

    await TutorialService.getUserProgress('u1')

    expect(stepUpsertMock).toHaveBeenCalled()
  })

  it('does not re-seed when content already exists', async () => {
    stepCountMock.mockResolvedValue(7)

    await TutorialService.getUserProgress('u1')

    expect(stepUpsertMock).not.toHaveBeenCalled()
  })

  it('checks only once per process, not on every read', async () => {
    // The cache is why this is affordable on a hot read path — without it
    // every progress fetch would pay a COUNT.
    stepCountMock.mockResolvedValue(3)

    await TutorialService.getUserProgress('u1')
    await TutorialService.getUserProgress('u1')
    await TutorialService.getUserProgress('u2')

    expect(stepCountMock).toHaveBeenCalledTimes(1)
  })

  it('seeds from a trigger firing before anyone has opened the tutorial', async () => {
    // The trigger path is reachable without any prior read — a character
    // gets created before the player ever visits /tutorial — so it cannot
    // rely on getUserProgress having seeded first.
    stepCountMock.mockResolvedValue(0)

    await TutorialService.handleTriggerEvent('u1', 'character_created')

    expect(stepUpsertMock).toHaveBeenCalled()
  })

  it('upserts rather than inserts, so seeding twice is harmless', async () => {
    // Idempotence is what makes lazy seeding safe against two concurrent
    // cold processes, and against an environment that already has content.
    stepCountMock.mockResolvedValue(0)

    await TutorialService.initializeTutorialSteps()

    expect(stepUpsertMock).toHaveBeenCalled()
    for (const call of stepUpsertMock.mock.calls as unknown as any[][]) {
      expect(call[0]).toHaveProperty('where.stepKey')
      expect(call[0]).toHaveProperty('create')
    }
  })

  it('seeds a non-empty, prerequisite-consistent step set', async () => {
    // The content is the feature — an empty seed would satisfy every
    // assertion above while leaving the tutorial exactly as broken. Every
    // prerequisite must also name a step that actually exists, or
    // getNextStep can never return the step that depends on it.
    stepCountMock.mockResolvedValue(0)

    await TutorialService.initializeTutorialSteps()

    const seeded = (stepUpsertMock.mock.calls as unknown as any[][]).map((c) => c[0].create)
    expect(seeded.length).toBeGreaterThan(0)

    const keys = new Set(seeded.map((s) => s.stepKey))
    for (const step of seeded) {
      for (const prerequisite of step.prerequisites ?? []) {
        expect(keys.has(prerequisite)).toBe(true)
      }
    }
    // At least one entry point, or nothing is ever reachable.
    expect(seeded.some((s) => (s.prerequisites ?? []).length === 0)).toBe(true)
  })
})
