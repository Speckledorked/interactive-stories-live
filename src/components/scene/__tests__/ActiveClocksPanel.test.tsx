// src/components/scene/__tests__/ActiveClocksPanel.test.tsx
//
// A player reported clocks that had visibly finished (currentTicks ===
// maxTicks) still sitting in the "ACTIVE CLOCKS" sidebar indefinitely.
// The filter here only ever excluded isHidden clocks — nothing excluded
// ones that had already run their course, even though Clock.resolvedAt
// exists specifically to mark that. These tests pin the fix: a completed
// clock (by tick count, the same signal the panel already had in hand)
// must not render, and a panel with nothing left to show must not render
// an empty "ACTIVE CLOCKS" header either.

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActiveClocksPanel } from '../ActiveClocksPanel'

function clock(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'clock1',
    name: 'Essence Market Panic',
    currentTicks: 0,
    maxTicks: 8,
    isHidden: false,
    ...overrides,
  }
}

describe('ActiveClocksPanel', () => {
  it('renders a clock that still has ticks remaining', () => {
    render(<ActiveClocksPanel clocks={[clock({ currentTicks: 3, maxTicks: 8 })]} campaignId="camp1" />)
    expect(screen.getByText('Essence Market Panic')).toBeTruthy()
  })

  it('does not render a clock that has reached maxTicks', () => {
    render(<ActiveClocksPanel clocks={[clock({ name: 'The Silver Landing', currentTicks: 6, maxTicks: 6 })]} campaignId="camp1" />)
    expect(screen.queryByText('The Silver Landing')).toBeNull()
  })

  it('renders no panel at all when every clock is complete or hidden', () => {
    const { container } = render(
      <ActiveClocksPanel
        clocks={[
          clock({ id: 'a', currentTicks: 6, maxTicks: 6 }),
          clock({ id: 'b', isHidden: true, currentTicks: 0, maxTicks: 4 }),
        ]}
        campaignId="camp1"
      />
    )
    expect(container.textContent).not.toContain('ACTIVE CLOCKS')
  })

  it('shows only the incomplete clocks alongside completed ones', () => {
    render(
      <ActiveClocksPanel
        clocks={[
          clock({ id: 'a', name: 'Astral Scar Drift', currentTicks: 8, maxTicks: 8 }),
          clock({ id: 'b', name: 'Outworlder Appetite', currentTicks: 3, maxTicks: 5 }),
        ]}
        campaignId="camp1"
      />
    )
    expect(screen.queryByText('Astral Scar Drift')).toBeNull()
    expect(screen.getByText('Outworlder Appetite')).toBeTruthy()
  })
})
