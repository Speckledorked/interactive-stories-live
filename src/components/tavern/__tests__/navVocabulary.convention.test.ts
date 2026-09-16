// src/components/tavern/__tests__/navVocabulary.convention.test.ts
//
// TavernSidebar and TavernMobileMenu are one navigation vocabulary, not two.
// TavernSidebar's own header says so — "the same three groups ... in the same
// order, with the same labels and icons, so there is one navigation
// vocabulary rather than two" — and until now nothing checked it.
//
// The failure it guards is not cosmetic. The sidebar is `lg:flex`, invisible
// below 1024px; the drawer is how phones reach everything the sidebar lists.
// A destination added to one and not the other is therefore reachable on
// desktop and unreachable on a phone, and it looks completely fine to whoever
// added it, because they were almost certainly looking at a desktop browser.
//
// That is not hypothetical: the homepage link went into the sidebar first and
// was invisible on mobile until someone tried to find it on a phone and
// couldn't. This test is that bug, written down.
//
// Source-scanning rather than importing the components, in the same spirit as
// the other *.convention tests in this repo: both link lists are built inside
// the component bodies from hooks and props, so there is nothing importable to
// compare without restructuring both files to satisfy a test.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const TAVERN = join(__dirname, '..')

/**
 * Static hrefs only. Campaign-scoped links are template literals built from
 * `campaignHome`, and those legitimately differ in shape between the two —
 * the bar carries four of them on mobile, so the drawer deliberately omits
 * them rather than listing them twice. It is the FIXED destinations that must
 * agree.
 */
function staticHrefs(file: string): Set<string> {
  const source = readFileSync(join(TAVERN, file), 'utf8')
  return new Set(Array.from(source.matchAll(/href:\s*'(\/[^'$]*)'/g), (m) => m[1]))
}

describe('the sidebar and the mobile drawer offer the same destinations', () => {
  it('finds links in both files at all', () => {
    // Both regexes silently matching nothing would make the comparison below
    // pass for the wrong reason (#443: a check that could not run has not
    // passed).
    expect(staticHrefs('TavernSidebar.tsx').size).toBeGreaterThan(3)
    expect(staticHrefs('TavernMobileMenu.tsx').size).toBeGreaterThan(3)
  })

  it('has no destination reachable on desktop but not on a phone', () => {
    const sidebar = staticHrefs('TavernSidebar.tsx')
    const drawer = staticHrefs('TavernMobileMenu.tsx')
    const desktopOnly = [...sidebar].filter((h) => !drawer.has(h)).sort()
    expect(
      desktopOnly,
      `Reachable from the sidebar but not the mobile drawer, so invisible below 1024px: ${desktopOnly.join(', ')}`
    ).toEqual([])
  })

  it('has no destination reachable on a phone but not on desktop', () => {
    const sidebar = staticHrefs('TavernSidebar.tsx')
    const drawer = staticHrefs('TavernMobileMenu.tsx')
    const mobileOnly = [...drawer].filter((h) => !sidebar.has(h)).sort()
    expect(
      mobileOnly,
      `Reachable from the mobile drawer but not the sidebar: ${mobileOnly.join(', ')}`
    ).toEqual([])
  })

  it('offers the homepage from both', () => {
    // Named explicitly rather than left to the set comparison: `/` is the one
    // destination with no other route to it — every other entry here is also
    // reachable from somewhere else in the app.
    expect(staticHrefs('TavernSidebar.tsx').has('/')).toBe(true)
    expect(staticHrefs('TavernMobileMenu.tsx').has('/')).toBe(true)
  })
})
