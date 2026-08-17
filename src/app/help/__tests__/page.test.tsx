// src/app/help/__tests__/page.test.tsx
//
// The reference page. What matters here is that it is FINDABLE — a player
// who saw a phrase on screen and wants to know what it means has to be
// able to type that phrase and land somewhere useful. Browsing by
// category is the fallback, not the primary route.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/help',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/clientAuth', () => ({
  authenticatedFetch: vi.fn(),
  isAuthenticated: () => true,
  getUser: () => ({ id: 'u1', email: 'u1@example.com' }),
  getLastCampaignId: () => null,
  getToken: () => null,
  logout: () => {},
}))

import HelpPage from '../page'
import { CATEGORY_LABELS, CATEGORY_ORDER, MECHANICS } from '@/lib/tutorial/content/mechanics'

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * Scoped to the page's own <main>, deliberately.
 *
 * The surrounding chrome (sidebar, mobile nav) links to Quests, World and
 * other destinations whose names are also mechanic names, so an unscoped
 * query matches nav furniture as readily as content and would pass on a
 * page that rendered no help at all.
 */
function content() {
  const main = document.querySelector('main')
  if (!main) throw new Error('help page rendered no <main>')
  return within(main as HTMLElement)
}

describe('/help', () => {
  it('lists every mechanic in the registry, grouped by category', () => {
    render(<HelpPage />)

    for (const category of CATEGORY_ORDER) {
      expect(content().getByText(CATEGORY_LABELS[category])).toBeTruthy()
    }
    for (const mechanic of MECHANICS) {
      expect(
        content().getByText(mechanic.term),
        `${mechanic.id} is missing from the index`
      ).toBeTruthy()
    }
  })

  // #449. The quickstart used to render below all six categories, so the
  // one visitor who most needs the short guided version — someone who has
  // just arrived — had to scroll past 41 reference entries to find the
  // only link to it. Asserted on DOCUMENT ORDER because the pre-existing
  // tests here checked presence only, and presence was never the problem.
  it('puts the quickstart above the reference list', () => {
    render(<HelpPage />)

    const main = document.querySelector('main')!
    const quickstart = within(main).getByText('How to play')
    const firstCategory = within(main).getByText(CATEGORY_LABELS[CATEGORY_ORDER[0]])

    // Node.compareDocumentPosition: FOLLOWING means the argument comes
    // after the node it is called on, in document order.
    const relation = quickstart.compareDocumentPosition(firstCategory)
    expect(
      relation & Node.DOCUMENT_POSITION_FOLLOWING,
      'the quickstart renders after the first category heading'
    ).toBeTruthy()
  })

  // It sat in both states before, which would now push results down the
  // page behind a card the searcher has already bypassed.
  it('gets out of the way once someone is searching', () => {
    render(<HelpPage />)
    const input = screen.getByLabelText('Search help')

    expect(content().queryByText('How to play')).toBeTruthy()

    fireEvent.change(input, { target: { value: 'x-card' } })
    expect(content().queryByText('How to play')).toBeNull()

    fireEvent.change(input, { target: { value: '' } })
    expect(content().queryByText('How to play')).toBeTruthy()
  })

  // The point of aliases. Nobody searches the name of the concept.
  it('finds a topic by a phrase the player actually saw on screen', () => {
    render(<HelpPage />)

    fireEvent.change(screen.getByLabelText('Search help'), {
      target: { value: 'heard secondhand' },
    })

    expect(content().getByText('Rumors and secondhand news')).toBeTruthy()
    expect(content().queryByText('Taking an action')).toBeNull()
  })

  it('finds the safety tools by the name of the button, not the section', () => {
    render(<HelpPage />)

    fireEvent.change(screen.getByLabelText('Search help'), {
      target: { value: 'x-card' },
    })

    expect(content().getByText('Safety tools')).toBeTruthy()
  })

  it('says so plainly when nothing matches', () => {
    render(<HelpPage />)

    fireEvent.change(screen.getByLabelText('Search help'), {
      target: { value: 'zzzznotathing' },
    })

    expect(content().getByText('Nothing matched that')).toBeTruthy()
  })

  it('restores the full browse list when the search is cleared', () => {
    render(<HelpPage />)
    const input = screen.getByLabelText('Search help')

    fireEvent.change(input, { target: { value: 'x-card' } })
    expect(content().queryByText('Scenes')).toBeNull()

    fireEvent.change(input, { target: { value: '' } })
    expect(content().getByText('Scenes')).toBeTruthy()
  })

  // The old page hardcoded "Dice Rolls (2d6 + Stat)" and the engine's stat
  // names. Campaign.statLabels renames those per campaign, so that copy
  // described a vocabulary most players never see anywhere.
  it('does not name the engine on a page with no campaign in context', () => {
    const { container } = render(<HelpPage />)
    expect(container.textContent).not.toMatch(/2d6|PbtA/i)
  })
})
