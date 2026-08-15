// src/components/tavern/mobileMenuStore.ts
//
// The drawer is opened from two places that aren't in the same subtree:
// TavernHeader's hamburger, and TavernNav's "More" tab. Both are mounted
// as siblings by each page, so neither can own the state for the other,
// and a context would need a provider placed above both — which means
// touching every page.
//
// A module-level store sidesteps the placement question entirely: any
// component anywhere can open the drawer, and TavernMobileMenu renders
// wherever it's mounted. It's ~20 lines against ~14 call-site edits and
// a provider that would exist only to pass one boolean down.

let open = false
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function openMobileMenu() {
  if (open) return
  open = true
  emit()
}

export function closeMobileMenu() {
  if (!open) return
  open = false
  emit()
}

export function subscribeMobileMenu(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getMobileMenuOpen() {
  return open
}

// Server snapshot: the drawer is never open during SSR, and returning a
// stable `false` (rather than reading the module variable) keeps
// hydration deterministic even if a previous render left it true.
export function getMobileMenuServerSnapshot() {
  return false
}
