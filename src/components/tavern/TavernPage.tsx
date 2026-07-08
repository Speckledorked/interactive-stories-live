// Root wrapper for every tavern-themed page: applies the body font, cancels
// out the global layout's container padding (so the background + fixed
// header/nav can go full-bleed), and renders the shared background layer.

import { bodyFont } from '@/lib/tavernTheme'
import { TavernBackground } from './TavernBackground'

export function TavernPage({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${bodyFont.className} -mx-4 -my-8 min-h-screen`}>
      <TavernBackground />
      {children}
    </div>
  )
}
