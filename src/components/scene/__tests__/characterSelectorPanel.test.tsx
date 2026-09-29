// src/components/scene/__tests__/characterSelectorPanel.test.tsx
//
// #495: the story page is one tap from the mobile bottom bar, and this
// panel used to `return null` for a player with no character. Every action
// control on that page is gated on selectedCharacterId, and this panel is
// the only thing that can set it — so a first-time player on a phone tapped
// Story, could start a scene, and then found nothing to do and nothing
// saying why. Blank space does not read as "you need a character"; it reads
// as a broken page.
//
// The gate is correct. The silence was the bug, and it was invisible to
// whoever added it because they had a character.

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CharacterSelectorPanel } from '../CharacterSelectorPanel'

vi.mock('next/link', () => ({
  default: ({ href, children }: any) => <a href={href}>{children}</a>,
}))

const props = {
  selectedCharacterId: '',
  onSelectCharacter: vi.fn(),
  selectedCharacter: null,
  onShowSnapshot: vi.fn(),
  campaignId: 'camp1',
}

describe('CharacterSelectorPanel with no characters', () => {
  it('renders a way out instead of nothing', () => {
    render(<CharacterSelectorPanel {...props} userCharacters={[]} />)
    expect(screen.getByText(/create a character/i)).toBeTruthy()
  })

  it('links somewhere that actually opens the creation form', () => {
    // The form lived behind lobby state with no URL, which is precisely why
    // no other page could offer a route to it.
    render(<CharacterSelectorPanel {...props} userCharacters={[]} />)
    const link = screen.getByText(/create a character/i).closest('a')
    expect(link?.getAttribute('href')).toBe('/campaigns/camp1?create=character')
  })

  it('says reading is still fine, so the empty state is not a wall', () => {
    render(<CharacterSelectorPanel {...props} userCharacters={[]} />)
    expect(screen.getByText(/read the story without one/i)).toBeTruthy()
  })
})

describe('CharacterSelectorPanel with characters', () => {
  it('still shows the picker rather than the CTA', () => {
    render(
      <CharacterSelectorPanel
        {...props}
        userCharacters={[{ id: 'c1', name: 'Vale' }]}
      />
    )
    expect(screen.getByText('SELECT CHARACTER')).toBeTruthy()
    expect(screen.queryByText(/create a character/i)).toBeNull()
  })
})
