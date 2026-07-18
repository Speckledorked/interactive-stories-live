// Root wrapper for every tavern-themed page: applies the body font, cancels
// out the global layout's container padding (so the background + fixed
// header/nav can go full-bleed), and renders the shared background layer.
//
// Pages migrated to the MythOS token system pass background="myth" to get
// the flat, theme-adaptive backdrop instead of the dark tavern art, and to
// skip the Cormorant Garamond body font override — they set their own
// (Public Sans, sitewide default) rather than inheriting a serif meant for
// the un-migrated tavern pages.

import { bodyFont } from '@/lib/tavernTheme'
import { TavernBackground } from './TavernBackground'

export function TavernPage({
  children,
  background = 'tavern',
}: {
  children: React.ReactNode
  background?: 'tavern' | 'myth'
}) {
  const fontClassName = background === 'myth' ? '' : bodyFont.className
  return (
    <div className={`${fontClassName} -mx-4 -my-8 min-h-screen`}>
      <TavernBackground variant={background} />
      {children}
    </div>
  )
}
