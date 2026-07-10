// Shared "tavern" theme primitives — dark-fantasy MythOS redesign.
// Fonts live in one module so every page shares the same font instances
// instead of each page re-importing next/font/google separately.

import { Cinzel, Cormorant_Garamond } from 'next/font/google'

export const displayFont = Cinzel({ subsets: ['latin'], weight: ['400', '600'] })
export const bodyFont = Cormorant_Garamond({ subsets: ['latin'], weight: ['400', '500', '600', '700'] })
