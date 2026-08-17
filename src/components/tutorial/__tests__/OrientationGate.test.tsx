// src/components/tutorial/__tests__/OrientationGate.test.tsx
//
// The trigger is the whole feature. A tutorial nobody is shown is exactly
// what this replaced — the previous system's steps lived in a table
// nothing ever seeded, so the failure was never "the content is wrong",
// it was "the content never reaches anyone".
//
// So these test the decision, not the prose: who gets shown the overlay,
// who does not, and what is remembered afterwards. The case that matters
// most is the first one — an account that predates this feature reads
// orientationSeenAt as null and must be shown it, because the people most
// in need of being told what this is are the ones who have been using it
// without ever having been told.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const { authenticatedFetchMock, isAuthenticatedMock, getUserMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
  isAuthenticatedMock: vi.fn(() => true),
  getUserMock: vi.fn(() => ({ id: 'u1', email: 'u1@example.com' })),
}))

vi.mock('@/lib/clientAuth', () => ({
  authenticatedFetch: authenticatedFetchMock,
  isAuthenticated: isAuthenticatedMock,
  getUser: getUserMock,
  getLastCampaignId: () => null,
  getToken: () => null,
}))

import { OrientationGate } from '../OrientationGate'
import { ORIENTATION_CARDS } from '@/lib/tutorial/content/orientation'

const FIRST_CARD_TITLE = ORIENTATION_CARDS[0].title

function userResponse(orientationSeenAt: string | null) {
  return { ok: true, json: async () => ({ user: { id: 'u1', orientationSeenAt } }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  isAuthenticatedMock.mockReturnValue(true)
  getUserMock.mockReturnValue({ id: 'u1', email: 'u1@example.com' })
})

describe('OrientationGate', () => {
  it('shows the intro to an existing account that has never seen it', async () => {
    // Null is what every row that predates the column reads as — the
    // migration adds it nullable with no backfill precisely so this
    // happens.
    authenticatedFetchMock.mockResolvedValue(userResponse(null))

    render(<OrientationGate />)

    await waitFor(() => expect(screen.getByText(FIRST_CARD_TITLE)).toBeTruthy())
  })

  it('stays out of the way once the account has seen it', async () => {
    authenticatedFetchMock.mockResolvedValue(userResponse('2026-08-01T00:00:00.000Z'))

    render(<OrientationGate />)

    await waitFor(() => expect(authenticatedFetchMock).toHaveBeenCalled())
    expect(screen.queryByText(FIRST_CARD_TITLE)).toBeNull()
  })

  it('renders nothing at all when signed out, so /login is unaffected', () => {
    isAuthenticatedMock.mockReturnValue(false)

    const { container } = render(<OrientationGate />)

    expect(container.firstChild).toBeNull()
    expect(authenticatedFetchMock).not.toHaveBeenCalled()
  })

  // The reason the localStorage cache exists: without it every page load
  // waits on /api/user before knowing whether to render, and a returning
  // user gets a flash of the intro on every navigation.
  it('answers from the local cache without a fetch on a repeat visit', async () => {
    window.localStorage.setItem('ai_gm_orientation_seen:u1', '1')

    render(<OrientationGate />)

    await waitFor(() => expect(screen.queryByText(FIRST_CARD_TITLE)).toBeNull())
    expect(authenticatedFetchMock).not.toHaveBeenCalled()
  })

  // A single global cache key would let the first user's dismissal hide
  // the intro from the second person to log in on the same browser.
  it('does not let one account\'s dismissal suppress another\'s', async () => {
    window.localStorage.setItem('ai_gm_orientation_seen:someone-else', '1')
    authenticatedFetchMock.mockResolvedValue(userResponse(null))

    render(<OrientationGate />)

    await waitFor(() => expect(screen.getByText(FIRST_CARD_TITLE)).toBeTruthy())
  })

  it('records the dismissal both locally and on the server', async () => {
    authenticatedFetchMock.mockResolvedValue(userResponse(null))

    render(<OrientationGate />)
    await waitFor(() => expect(screen.getByText(FIRST_CARD_TITLE)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

    await waitFor(() =>
      expect(authenticatedFetchMock).toHaveBeenCalledWith(
        '/api/user',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ orientationSeenAt: true }),
        })
      )
    )
    expect(window.localStorage.getItem('ai_gm_orientation_seen:u1')).toBe('1')
    expect(screen.queryByText(FIRST_CARD_TITLE)).toBeNull()
  })

  // Failure posture is silence. An intro screen is not worth interrupting
  // a session over, and one that reappears because a read failed is worse
  // than one that was missed.
  it('says nothing when the lookup fails', async () => {
    authenticatedFetchMock.mockRejectedValue(new Error('offline'))

    render(<OrientationGate />)

    await waitFor(() => expect(authenticatedFetchMock).toHaveBeenCalled())
    expect(screen.queryByText(FIRST_CARD_TITLE)).toBeNull()
  })

  it('says nothing when the lookup returns an error status', async () => {
    authenticatedFetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })

    render(<OrientationGate />)

    await waitFor(() => expect(authenticatedFetchMock).toHaveBeenCalled())
    expect(screen.queryByText(FIRST_CARD_TITLE)).toBeNull()
  })

  it('walks forward through every card and finishes', async () => {
    authenticatedFetchMock.mockResolvedValue(userResponse(null))

    render(<OrientationGate />)
    await waitFor(() => expect(screen.getByText(FIRST_CARD_TITLE)).toBeTruthy())

    for (let i = 0; i < ORIENTATION_CARDS.length - 1; i++) {
      expect(screen.getByText(ORIENTATION_CARDS[i].title)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    }

    const last = ORIENTATION_CARDS[ORIENTATION_CARDS.length - 1]
    expect(screen.getByText(last.title)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Start playing' }))
    await waitFor(() => expect(screen.queryByText(last.title)).toBeNull())
  })
})
