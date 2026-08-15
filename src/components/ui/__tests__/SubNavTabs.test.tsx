// src/components/ui/__tests__/SubNavTabs.test.tsx
//
// This component consolidates a sub-navigation tab bar that used to be
// hand-rolled, near-identically, across 6 page files — three built from a
// local tabs array + .map(), two hand-writing each tab's JSX individually
// with no array at all. The three interaction models each of those files
// used (Link to a sibling page, button that switches in-page state, and
// an inert span for the current page's own tab) all have to keep working
// exactly as before, so those are what these tests pin down.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SubNavTabs, type SubNavTab } from '../SubNavTabs'

function Icon({ className }: { className?: string }) {
  return <svg data-testid="icon-component" className={className} />
}

describe('SubNavTabs', () => {
  it('renders a tab with an href as a link', () => {
    const tabs: SubNavTab[] = [{ key: 'a', label: 'Overview', icon: Icon, href: '/overview' }]
    render(<SubNavTabs tabs={tabs} activeKey="a" />)

    const link = screen.getByRole('link', { name: /Overview/ })
    expect(link).toHaveAttribute('href', '/overview')
  })

  it('renders a tab with no href but an onSelect as a clickable button', () => {
    const onSelect = vi.fn()
    const tabs: SubNavTab[] = [{ key: 'a', label: 'Friends', icon: Icon }]
    render(<SubNavTabs tabs={tabs} activeKey="a" onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /Friends/ }))
    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('renders a tab with no href and no onSelect as inert text, not a link or button', () => {
    const tabs: SubNavTab[] = [{ key: 'a', label: 'Characters', icon: Icon }]
    render(<SubNavTabs tabs={tabs} activeKey="a" />)

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Characters')).toBeTruthy()
  })

  it('marks the tab matching activeKey as active, others as inactive', () => {
    const tabs: SubNavTab[] = [
      { key: 'a', label: 'One', icon: Icon, href: '/one' },
      { key: 'b', label: 'Two', icon: Icon, href: '/two' },
    ]
    render(<SubNavTabs tabs={tabs} activeKey="b" />)

    const one = screen.getByRole('link', { name: /One/ })
    const two = screen.getByRole('link', { name: /Two/ })
    expect(one.className).toContain('border-transparent')
    // Was border-ember-400: this pinned the old `variant="tavern"`
    // default's active class. That variant is gone (every page is on the
    // myth token system), so the class genuinely changed rather than the
    // assertion being loosened to hide a regression.
    expect(two.className).toContain('border-myth-accent')
  })

  // The string-icon case this used to cover is gone on purpose: SubNavTab's
  // `icon` no longer accepts a string, so an emoji here is a compile error
  // rather than a supported second rendering path. Keeping a runtime test
  // for it would have meant keeping the branch alive to test.

  it('renders an icon component when icon is a component, not a string', () => {
    const tabs: SubNavTab[] = [{ key: 'a', label: 'Friends', icon: Icon, href: '/friends' }]
    render(<SubNavTabs tabs={tabs} activeKey="a" />)

    expect(screen.getByTestId('icon-component')).toBeTruthy()
  })

  it('shows a badge only when one is provided and non-zero', () => {
    const tabs: SubNavTab[] = [
      { key: 'a', label: 'Requests', icon: Icon, badge: 3 },
      { key: 'b', label: 'Search', icon: Icon, badge: 0 },
    ]
    render(<SubNavTabs tabs={tabs} activeKey="a" onSelect={() => {}} />)

    expect(screen.getByText('3')).toBeTruthy()
    // "Search" has badge: 0, which is falsy -- same as the original `!!tab.badge` check.
    const searchButton = screen.getByRole('button', { name: /Search/ })
    expect(searchButton.textContent).not.toContain('0')
  })

  it('appends itemClassName on top of the base classes', () => {
    const tabs: SubNavTab[] = [{ key: 'a', label: 'Wiki', icon: Icon, href: '/wiki' }]
    render(<SubNavTabs tabs={tabs} activeKey="a" itemClassName="whitespace-nowrap flex-shrink-0" />)

    const link = screen.getByRole('link', { name: /Wiki/ })
    expect(link.className).toContain('whitespace-nowrap')
    expect(link.className).toContain('flex-shrink-0')
  })

  it('treats a null href the same as an absent one (renders inert, not a broken link)', () => {
    const tabs: SubNavTab[] = [{ key: 'a', label: 'Story', icon: Icon, href: null }]
    render(<SubNavTabs tabs={tabs} activeKey="a" />)

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Story')).toBeTruthy()
  })

  // Which tab is active used to be conveyed by colour alone, so a screen
  // reader announced every tab identically. These pin the fix across all
  // three interaction models -- and pin that only the ACTIVE one carries
  // the attribute, since aria-current on every tab is the same as on none.
  it('marks the active link with aria-current="page" and leaves the others without it', () => {
    const tabs: SubNavTab[] = [
      { key: 'a', label: 'One', icon: Icon, href: '/one' },
      { key: 'b', label: 'Two', icon: Icon, href: '/two' },
    ]
    render(<SubNavTabs tabs={tabs} activeKey="b" />)

    expect(screen.getByRole('link', { name: /Two/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /One/ })).not.toHaveAttribute('aria-current')
  })

  it('marks the active button with aria-current', () => {
    const tabs: SubNavTab[] = [
      { key: 'a', label: 'One', icon: Icon },
      { key: 'b', label: 'Two', icon: Icon },
    ]
    render(<SubNavTabs tabs={tabs} activeKey="a" onSelect={() => {}} />)

    expect(screen.getByRole('button', { name: /One/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /Two/ })).not.toHaveAttribute('aria-current')
  })

  it('marks the inert current-page label with aria-current="page"', () => {
    const tabs: SubNavTab[] = [{ key: 'a', label: 'Characters', icon: Icon }]
    render(<SubNavTabs tabs={tabs} activeKey="a" />)

    // getByText returns the inner label span; the attribute is on the
    // wrapper that carries the tab's own classes.
    expect(screen.getByText('Characters').parentElement).toHaveAttribute('aria-current', 'page')
  })
})
