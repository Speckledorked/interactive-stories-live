// Root wrapper for every page: cancels out the global layout's container
// padding (so the background and the fixed header/nav can go full-bleed)
// and renders the shared background layer.
//
// This used to take a `background` prop selecting between the myth token
// system and the older permanently-dark tavern theme. Every page is on
// myth now, so the tavern branch had no callers and is gone along with
// the prop — that also retires the Cormorant Garamond body-font override,
// since the pages that needed it no longer exist. See docs/design-system.md.
import { TavernBackground } from './TavernBackground'

export function TavernPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 -my-8 min-h-screen">
      <TavernBackground />
      {/* lg:pl-64 makes room for TavernSidebar (mounted by TavernHeader,
          fixed, so it doesn't push flow content on its own). */}
      <div className="lg:pl-64">{children}</div>
    </div>
  )
}
