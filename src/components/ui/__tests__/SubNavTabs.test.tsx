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
    expect(two.className).toContain('border-ember-400')
  })

  it('renders a string icon (emoji) as plain text instead of a component', () => {
    const tabs: SubNavTab[] = [{ key: 'a', label: 'NPCs', icon: '👤', href: '/npcs' }]
    render(<SubNavTabs tabs={tabs} activeKey="a" />)

    expect(screen.queryByTestId('icon-component')).toBeNull()
    expect(screen.getByText('👤')).toBeTruthy()
  })

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
})
