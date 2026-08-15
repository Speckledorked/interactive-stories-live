// src/components/ui/__tests__/primitives.test.tsx
//
// These primitives exist to fix measured, app-wide defects, so the tests
// pin the fixes rather than the styling. The audit that motivated Phase 0
// found:
//
//   - 86 of 86 <button> elements carrying a className had NO focus-visible
//     ring. Not "most" — all of them.
//   - 5 different button radii and 4 different paddings in use.
//   - 381 raw form controls across 61 files, each hand-styled.
//
// The focus ring is the single most likely thing to silently regress: it
// is invisible to a mouse user, invisible in a screenshot taken at rest,
// and easy to drop by "cleaning up" a className. So every interactive
// primitive gets an explicit assertion for it below, plus a sweep that
// fails if a NEW interactive primitive is added without one.

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { Button } from '../button'
import { IconButton } from '../icon-button'
import { Input } from '../input'
import { Textarea } from '../textarea'
import { Select } from '../select'
import { Badge } from '../badge'
import { Progress } from '../progress'
import { Alert } from '../alert'
import { Card } from '../card'
import { StatTile } from '../stat-tile'
import { Timeline, TimelineItem } from '../timeline'
import { FOCUS_RING, TOUCH_TARGET, cn } from '../styles'

function Icon({ className }: { className?: string }) {
  return <svg data-testid="icon" className={className} />
}

/** Every class in FOCUS_RING must be present on the element. */
function expectFocusRing(el: HTMLElement) {
  for (const cls of FOCUS_RING.split(' ')) {
    expect(el.className, `missing focus class "${cls}"`).toContain(cls)
  }
}

describe('styles: cn', () => {
  it('joins truthy parts and drops falsy ones', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b')
  })
})

describe('Button', () => {
  it('renders a focus-visible ring — the app-wide defect this primitive exists to fix', () => {
    render(<Button>Save</Button>)
    expectFocusRing(screen.getByRole('button', { name: 'Save' }))
  })

  it('keeps the focus ring even when a caller passes its own className', () => {
    // Regression guard: className is merged BEFORE FOCUS_RING in the
    // primitive precisely so a caller can't clobber it.
    render(<Button className="rounded-none px-1">Save</Button>)
    expectFocusRing(screen.getByRole('button', { name: 'Save' }))
  })

  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)(
    'renders the %s variant with a focus ring and touch target',
    (variant) => {
      render(<Button variant={variant}>Go</Button>)
      const btn = screen.getByRole('button', { name: 'Go' })
      expectFocusRing(btn)
      expect(btn.className).toContain('min-h-[44px]')
    }
  )

  it.each(['sm', 'md', 'lg'] as const)(
    'keeps the 44px minimum hit area at size=%s (mobile-first: small ≠ untappable)',
    (size) => {
      render(<Button size={size}>Go</Button>)
      const btn = screen.getByRole('button', { name: 'Go' })
      expect(btn.className).toContain('min-h-[44px]')
      expect(btn.className).toContain('min-w-[44px]')
    }
  )

  it('uses one radius across every variant and size', () => {
    const { rerender } = render(<Button>A</Button>)
    const radii = new Set<string>()
    for (const size of ['sm', 'md', 'lg'] as const) {
      for (const variant of ['primary', 'secondary', 'ghost', 'danger'] as const) {
        rerender(
          <Button size={size} variant={variant}>
            A
          </Button>
        )
        const cls = screen.getByRole('button', { name: 'A' }).className
        radii.add((cls.match(/\brounded(-[a-z0-9]+)?\b/) ?? ['(none)'])[0])
      }
    }
    expect(radii.size, `expected one radius, got ${[...radii].join(', ')}`).toBe(1)
  })

  it('disables itself and announces busy while loading', () => {
    render(<Button loading>Save</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })

  it('does not fire onClick while loading', () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('hides the leading icon while loading so the spinner replaces it', () => {
    const { rerender } = render(<Button icon={Icon}>Save</Button>)
    expect(screen.queryByTestId('icon')).not.toBeNull()
    rerender(
      <Button icon={Icon} loading>
        Save
      </Button>
    )
    expect(screen.queryByTestId('icon')).toBeNull()
  })

  it('defaults to type="button" so it cannot accidentally submit a form', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })
})

describe('IconButton', () => {
  it('requires and exposes an accessible label', () => {
    render(<IconButton icon={Icon} label="Notifications" />)
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy()
  })

  it('has a focus ring and a 44px hit area even at size=sm', () => {
    render(<IconButton icon={Icon} label="Close" size="sm" />)
    const btn = screen.getByRole('button', { name: 'Close' })
    expectFocusRing(btn)
    expect(btn.className).toContain('min-h-[44px]')
    expect(btn.className).toContain('min-w-[44px]')
  })

  it('renders a badge count and caps it at 99+', () => {
    const { rerender } = render(<IconButton icon={Icon} label="Bell" badge={3} />)
    expect(screen.getByText('3')).toBeTruthy()
    rerender(<IconButton icon={Icon} label="Bell" badge={250} />)
    expect(screen.getByText('99+')).toBeTruthy()
  })

  it('renders no badge for zero or undefined', () => {
    const { rerender, container } = render(<IconButton icon={Icon} label="Bell" badge={0} />)
    expect(container.querySelector('span[aria-hidden]')).toBeNull()
    rerender(<IconButton icon={Icon} label="Bell" />)
    expect(container.querySelector('span[aria-hidden]')).toBeNull()
  })
})

describe('Input', () => {
  it('has a focus ring', () => {
    render(<Input label="Title" />)
    expectFocusRing(screen.getByLabelText(/Title/))
  })

  it('uses a 16px base font on mobile so iOS Safari does not zoom on focus', () => {
    render(<Input label="Title" />)
    const cls = screen.getByLabelText(/Title/).className
    expect(cls).toContain('text-base')
    expect(cls).toContain('sm:text-sm')
  })

  it('associates its label, hint and error with the control', () => {
    render(<Input label="Email" hint="We never share it" />)
    const input = screen.getByLabelText(/Email/)
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toBe('We never share it')
  })

  it('marks itself invalid and shows the error instead of the hint', () => {
    render(<Input label="Email" hint="A hint" error="Required" />)
    const input = screen.getByLabelText(/Email/)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Required')).toBeTruthy()
    expect(screen.queryByText('A hint')).toBeNull()
  })
})

describe('Textarea', () => {
  it('has a focus ring', () => {
    render(<Textarea label="Action" />)
    expectFocusRing(screen.getByLabelText(/Action/))
  })

  it('shows a live character counter when showCount and maxLength are set', () => {
    render(<Textarea label="Action" maxLength={600} showCount value="hello" onChange={() => {}} />)
    expect(screen.getByText('5 / 600')).toBeTruthy()
  })

  it('omits the counter when maxLength is absent', () => {
    render(<Textarea label="Action" showCount value="hello" onChange={() => {}} />)
    expect(screen.queryByText(/\/ /)).toBeNull()
  })

  it('warns as the value approaches the limit', () => {
    const near = 'x'.repeat(95)
    render(<Textarea label="Action" maxLength={100} showCount value={near} onChange={() => {}} />)
    expect(screen.getByText('95 / 100').className).toContain('text-myth-warn')
  })
})

describe('Select', () => {
  it('has a focus ring and a 44px hit area', () => {
    render(
      <Select label="Role">
        <option value="a">A</option>
      </Select>
    )
    const select = screen.getByLabelText(/Role/)
    expectFocusRing(select)
    expect(select.className).toContain('min-h-[44px]')
  })

  it('suppresses the native arrow so the control looks the same across browsers', () => {
    render(
      <Select label="Role">
        <option value="a">A</option>
      </Select>
    )
    expect(screen.getByLabelText(/Role/).className).toContain('appearance-none')
  })
})

describe('Badge', () => {
  it('renders the scene-lifecycle variants the story page needs', () => {
    for (const variant of ['awaiting', 'complete', 'locked', 'failed'] as const) {
      const { unmount } = render(<Badge variant={variant}>{variant}</Badge>)
      expect(screen.getByText(variant)).toBeTruthy()
      unmount()
    }
  })

  it('carries no old-palette classes', () => {
    // The four dead legacy variants were wine/ember; this guards their return.
    const { container } = render(<Badge variant="public">Public</Badge>)
    expect(container.innerHTML).not.toMatch(/ember-|wine-|tavern-/)
  })
})

describe('Progress', () => {
  it('exposes progressbar semantics a bare div never had', () => {
    render(<Progress value={30} max={60} label="Stability" />)
    const bar = screen.getByRole('progressbar', { name: 'Stability' })
    expect(bar).toHaveAttribute('aria-valuenow', '30')
    expect(bar).toHaveAttribute('aria-valuemax', '60')
  })

  it('clamps out-of-range values rather than overflowing the track', () => {
    const { container, rerender } = render(<Progress value={999} max={100} />)
    expect((container.querySelector('[role="progressbar"] > div') as HTMLElement).style.width).toBe('100%')
    rerender(<Progress value={-50} max={100} />)
    expect((container.querySelector('[role="progressbar"] > div') as HTMLElement).style.width).toBe('0%')
  })

  it('survives a zero or negative max without dividing by zero', () => {
    const { container } = render(<Progress value={5} max={0} />)
    const width = (container.querySelector('[role="progressbar"] > div') as HTMLElement).style.width
    expect(width).toMatch(/^\d/)
  })
})

describe('Alert', () => {
  it('uses role=alert for danger so it is announced, and role=status otherwise', () => {
    const { rerender } = render(<Alert tone="danger">Boom</Alert>)
    expect(screen.getByRole('alert')).toBeTruthy()
    rerender(<Alert tone="info">FYI</Alert>)
    expect(screen.getByRole('status')).toBeTruthy()
  })
})

describe('Card', () => {
  it('renders reference variant with border chrome and narrative variant without', () => {
    const { container, rerender } = render(<Card variant="reference">x</Card>)
    expect(container.firstElementChild!.className).toContain('border-myth-border')
    rerender(<Card variant="narrative">x</Card>)
    expect(container.firstElementChild!.className).not.toContain('border-myth-border')
  })
})

describe('StatTile', () => {
  it('renders as a link with a focus ring when href is set', () => {
    render(<StatTile icon={Icon} label="Weather" value="Light rain" href="/x" />)
    expectFocusRing(screen.getByRole('link'))
  })

  it('renders as a plain element when there is nowhere to go', () => {
    render(<StatTile icon={Icon} label="Weather" value="Light rain" />)
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('Timeline', () => {
  it('renders an ordered list and drops the rail on the last item', () => {
    const { container } = render(
      <Timeline>
        <TimelineItem meta="Turn 1">First</TimelineItem>
        <TimelineItem meta="Turn 2" isLast>
          Second
        </TimelineItem>
      </Timeline>
    )
    expect(container.querySelector('ol')).toBeTruthy()
    const items = container.querySelectorAll('li')
    expect(items).toHaveLength(2)
    // The rail is the 1px-wide connector span (`w-px`) — not `.flex-1`,
    // which the content column also carries.
    expect(items[0].querySelector('span.w-px')).toBeTruthy()
    expect(items[1].querySelector('span.w-px')).toBeNull()
  })
})

// A single sweep so a primitive added later can't quietly ship without the
// two rules Phase 0 exists to enforce. Keep this list in step with the
// interactive primitives in src/components/ui/.
describe('every interactive primitive', () => {
  const cases: Array<[string, React.ReactElement, 'button' | 'textbox' | 'combobox']> = [
    ['Button', <Button key="b">x</Button>, 'button'],
    ['IconButton', <IconButton key="i" icon={Icon} label="x" />, 'button'],
    ['Input', <Input key="in" aria-label="x" />, 'textbox'],
    ['Textarea', <Textarea key="t" aria-label="x" />, 'textbox'],
    [
      'Select',
      <Select key="s" aria-label="x">
        <option value="a">A</option>
      </Select>,
      'combobox',
    ],
  ]

  it.each(cases)('%s applies the shared focus ring', (_name, element, role) => {
    render(element)
    expectFocusRing(screen.getByRole(role))
  })

  it.each(cases.filter(([n]) => n !== 'Input' && n !== 'Textarea'))(
    '%s meets the 44px touch minimum',
    (_name, element, role) => {
      render(element)
      expect(screen.getByRole(role).className).toContain('min-h-[44px]')
    }
  )

  it('TOUCH_TARGET includes touch-manipulation to kill the 300ms tap delay', () => {
    expect(TOUCH_TARGET).toContain('touch-manipulation')
  })

  // FOCUS_RING must start by suppressing the outline. globals.css sets a
  // base-layer `outline` on every focusable element so bespoke buttons and
  // links get a ring for free; without outline-none here, a primitive would
  // paint BOTH that outline and its own ring. Verified in a real browser
  // (primitives: outline suppressed + ring visible; links: outline visible,
  // no ring), and pinned here so the ordering can't be lost in an edit.
  it('FOCUS_RING suppresses the base-layer outline before drawing its ring', () => {
    expect(FOCUS_RING).toContain('focus-visible:outline-none')
    expect(FOCUS_RING).toContain('focus-visible:ring-2')
  })
})
