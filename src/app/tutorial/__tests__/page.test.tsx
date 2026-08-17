// src/app/tutorial/__tests__/page.test.tsx
//
// Rewritten alongside the page itself.
//
// The previous tests here rendered the DB-backed checklist and asserted
// its tallies against a mocked /api/tutorial/progress response. They
// passed — and the page still taught nobody anything, because in
// production that endpoint reads `tutorial_steps`, a table nothing has
// ever seeded (initializeTutorialSteps() has no callers repo-wide). The
// tests proved the component could render rows it was handed; nothing
// proved there would ever BE rows.
//
// That is the failure this file is now written against: content comes
// from a typechecked module that ships with the code, so "does the page
// show real teaching content" is answerable without a database at all.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/tutorial',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/clientAuth', () => ({
  authenticatedFetch: vi.fn(),
  isAuthenticated: () => true,
  getUser: () => ({ id: 'u1', email: 'u1@example.com' }),
  getLastCampaignId: () => null,
  // TavernHeader's bell reads the unread count, which needs a token.
  // Null is the "no token" path the hook handles by rendering no badge.
  getToken: () => null,
  logout: () => {},
}))

import TutorialPage from '../page'
import { WALKTHROUGH } from '@/lib/tutorial/content/walkthrough'
import { getMechanic } from '@/lib/tutorial/content/mechanics'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('/tutorial page', () => {
  it('renders teaching content with no database and no fetch at all', () => {
    render(<TutorialPage />)

    // Every section heading from the registry is on the page.
    for (const section of WALKTHROUGH) {
      expect(screen.getByText(section.title)).toBeTruthy()
    }

    // And every mechanic it names renders its real prose, not a title
    // over an empty block.
    for (const section of WALKTHROUGH) {
      for (const id of section.mechanicIds) {
        const mechanic = getMechanic(id)
        expect(mechanic).toBeDefined()
        expect(screen.getByText(mechanic!.body[0])).toBeTruthy()
      }
    }
  })

  it('teaches the two things a player must not discover the hard way', () => {
    render(<TutorialPage />)

    // Money and safety are in the walkthrough on purpose: being charged
    // without warning, or having no idea there is a way to stop content,
    // are the two failures that cost a real person something.
    const taught = WALKTHROUGH.flatMap(s => s.mechanicIds)
    expect(taught).toContain('scene-cost')
    expect(taught).toContain('safety')
  })

  it('does not render a progress bar over content it cannot measure', () => {
    const { container } = render(<TutorialPage />)

    // The old page drew "0%" and "0 Completed" against an empty table.
    // A completion metric here would be measuring nothing again.
    expect(container.textContent).not.toMatch(/\d+%/)
    expect(container.textContent).not.toMatch(/Completed/)
  })

  it('points at the full reference rather than trying to be it', () => {
    render(<TutorialPage />)
    expect(screen.getByText('That is the whole tutorial')).toBeTruthy()
  })
})
