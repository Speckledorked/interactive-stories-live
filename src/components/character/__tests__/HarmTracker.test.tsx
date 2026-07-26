// src/components/character/__tests__/HarmTracker.test.tsx
//
// The harm tracker read from its own copy of the harm bands.
//
// getHarmStatus in lib/game/harm.ts is the definition the dice and the
// narration use, and it had no callers — while this component hardcoded
// the same thresholds three times over (status label, banner visibility,
// banner text) in its own wording. Nothing tied them together, so the
// numbers a player read were only coincidentally the ones being applied.
//
// The test that matters is the last one: it fails if the component ever
// stops agreeing with the engine, which is the whole point of the change.

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import HarmTracker from '../HarmTracker'
import { getHarmStatus, HarmLevel } from '@/lib/game/harm'

describe('HarmTracker', () => {
  it('reports the engine’s label at each band', () => {
    render(<HarmTracker current={0} />)
    expect(screen.getByText('Fine')).toBeTruthy()

    render(<HarmTracker current={4} />)
    expect(screen.getByText('Impaired')).toBeTruthy()

    render(<HarmTracker current={6} />)
    expect(screen.getByText('Taken Out')).toBeTruthy()
  })

  it('warns with the engine’s own description, including the roll penalty', () => {
    render(<HarmTracker current={4} />)
    expect(screen.getByText(/-1 to all rolls/)).toBeTruthy()
  })

  it('shows no warning while a character is unhurt enough to be Fine', () => {
    const { container } = render(<HarmTracker current={3} />)
    expect(container.textContent).not.toContain('⚠️')
  })

  it('does not render the -999 "cannot act" sentinel as a modifier', () => {
    // getHarmStatus uses -999 to mean "cannot act" rather than a number to
    // add to a roll. Its description is prose for exactly this reason, and
    // rendering the raw penalty here would print nonsense to the player.
    const { container } = render(<HarmTracker current={6} />)
    expect(container.textContent).not.toContain('999')
    expect(container.textContent).toContain('Unconscious, captured, or dying')
  })

  it('clamps a harm value outside the track rather than blanking the label', () => {
    render(<HarmTracker current={99} />)
    expect(screen.getByText('Taken Out')).toBeTruthy()

    render(<HarmTracker current={-2} />)
    expect(screen.getAllByText('Fine').length).toBeGreaterThan(0)
  })

  it('hides the label row entirely when asked to', () => {
    const { container } = render(<HarmTracker current={5} showLabel={false} />)
    expect(container.textContent).not.toContain('Impaired')
  })

  it('agrees with getHarmStatus at every point on the track', () => {
    // The regression guard. If someone moves the Impaired threshold in the
    // engine, this fails instead of the UI silently reporting the old one.
    for (let harm = 0; harm <= 6; harm++) {
      const { container, unmount } = render(<HarmTracker current={harm} />)
      const expected = getHarmStatus(harm as HarmLevel)
      expect(container.textContent, `harm ${harm}`).toContain(expected.status)
      if (expected.status !== 'Fine') {
        expect(container.textContent, `harm ${harm}`).toContain(expected.description)
      }
      unmount()
    }
  })
})
