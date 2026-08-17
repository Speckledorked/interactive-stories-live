// src/components/scene/__tests__/TurnOrderPanel.test.tsx
//
// Turn order is advisory: submitting an action is never blocked by it
// (see TurnTracker's own doc comment, and the route that backs it). That
// is a real, load-bearing rule — a player who believes they must wait
// will sit out a scene for no reason.
//
// It was stated only in a `title=` attribute, which is invisible to every
// touch user on a mobile-first product, and it was stated on the DISABLED
// state — where nobody would wonder — while the ENABLED state, which
// renders a highlighted "current player" that reads exactly like a lock,
// said nothing at all.
//
// These pin the rule's VISIBILITY, not its wording, so it cannot quietly
// regress into a tooltip again.

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'fs'
import { join } from 'path'

// TurnTracker fetches on mount and renders the live queue; this suite is
// about the panel's own copy, not the tracker's internals.
vi.mock('@/components/turns/TurnTracker', () => ({
  default: () => <div data-testid="turn-tracker" />,
}))

import { TurnOrderPanel } from '../TurnOrderPanel'

const SOURCE = readFileSync(
  join(process.cwd(), 'src/components/scene/TurnOrderPanel.tsx'),
  'utf-8'
)

const baseProps = {
  currentScene: { id: 'scene1' },
  campaignId: 'c1',
  currentUserId: 'u1',
  isHost: false,
  onEndTurnOrder: () => {},
  endingTurnOrder: false,
  onEnableTurnOrder: () => {},
  enablingTurnOrder: false,
}

describe('TurnOrderPanel', () => {
  it('tells a player the queue does not block them, while the queue is on', () => {
    const { container } = render(
      <TurnOrderPanel {...baseProps} sceneTurnInfo={{ id: 'turn1' }} />
    )

    // The state that actually needs the reassurance.
    expect(container.textContent).toMatch(/not a lock/i)
    expect(container.textContent).toMatch(/whenever you like/i)
  })

  it('still says play is freeform when the queue is off', () => {
    const { container } = render(<TurnOrderPanel {...baseProps} sceneTurnInfo={null} />)
    expect(container.textContent).toMatch(/freeform/i)
  })

  it('renders nothing without a scene', () => {
    const { container } = render(
      <TurnOrderPanel {...baseProps} currentScene={null} sceneTurnInfo={null} />
    )
    expect(container.firstChild).toBeNull()
  })

  // The regression this file exists for. A hover-only tooltip is not a
  // way to state a rule on a product whose primary surface is a phone.
  it('does not hide rules text in a hover-only title attribute', () => {
    expect(SOURCE).not.toMatch(/title="/)
  })
})
