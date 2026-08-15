// src/app/tutorial/__tests__/page.test.tsx
// #308: GET /api/tutorial/progress returns `{ progress, nextStep,
// completionPercentage }`, but this page read `data.steps` — a key that
// never existed — so `steps` stayed permanently `[]`. Every category
// section (which renders null when its own step list is empty) never
// rendered at all; only the completion-percentage bar worked, since it
// read the correctly-named key. This renders the page against the API's
// real response shape and asserts the step list and tallies actually
// populate, the gap the bug shipped through unnoticed.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/tutorial',
  useSearchParams: () => new URLSearchParams(),
}))

// TavernPage's font module calls next/font/google at module load time,
// which only works inside an actual Next.js build — not under vitest.
vi.mock('@/lib/tavernTheme', () => ({
  displayFont: { className: 'font-display' },
  bodyFont: { className: 'font-body' },
}))

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}))

vi.mock('@/lib/clientAuth', () => ({
  authenticatedFetch: authenticatedFetchMock,
  isAuthenticated: () => true,
  getUser: () => ({ id: 'u1', email: 'u1@example.com' }),
  getLastCampaignId: () => null,
}))

import TutorialPage from '../page'

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

function progressStep(overrides: Record<string, unknown> = {}) {
  return {
    id: 'step1',
    stepKey: 'welcome',
    title: 'Welcome to MythOS',
    description: 'Learn the basics',
    category: 'basics',
    orderIndex: 1,
    isOptional: false,
    userProgress: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('/tutorial page', () => {
  it('renders the step checklist and tallies from the real API response shape (progress, not steps)', async () => {
    authenticatedFetchMock.mockResolvedValue(
      jsonResponse({
        progress: [
          progressStep({ id: 's1', stepKey: 'welcome', title: 'Welcome to MythOS', userProgress: { status: 'COMPLETED', completedAt: '2026-01-01' } }),
          progressStep({ id: 's2', stepKey: 'create_character', title: 'Create Your Character', userProgress: { status: 'IN_PROGRESS' } }),
          progressStep({ id: 's3', stepKey: 'first_scene', title: 'Your First Scene', userProgress: null }),
        ],
        nextStep: null,
        completionPercentage: 33,
      })
    )

    render(<TutorialPage />)

    await waitFor(() => expect(screen.getByText('Welcome to MythOS')).toBeTruthy())
    expect(screen.getByText('Create Your Character')).toBeTruthy()
    expect(screen.getByText('Your First Scene')).toBeTruthy()

    // The tallies at the top are computed from the same `steps` state —
    // these only ever read 0/0/0 while `steps` stayed permanently empty.
    expect(screen.getByText('1 Completed')).toBeTruthy()
    expect(screen.getByText('1 In Progress')).toBeTruthy()
    expect(screen.getByText('1 Not Started')).toBeTruthy()
    expect(screen.getByText('33%')).toBeTruthy()
  })

  it('renders nothing in the checklist (but does not crash) when the API returns no progress at all', async () => {
    authenticatedFetchMock.mockResolvedValue(jsonResponse({ progress: [], nextStep: null, completionPercentage: 0 }))

    render(<TutorialPage />)

    await waitFor(() => expect(screen.getByText('0%')).toBeTruthy())
    expect(screen.getByText('0 Completed')).toBeTruthy()
  })
})
