// Self-hosted type faces for the MythOS redesign, loaded via next/font/local
// so there is no runtime dependency on a font CDN.
//
// - fontDisplay (Fraunces): literary serif, headings only
// - fontSans (Public Sans): humanist sans, body/UI text
// - fontMono (IBM Plex Mono): data/metadata, tabular values
import localFont from 'next/font/local'

export const fontDisplay = localFont({
  src: '../fonts/fraunces-variable.woff2',
  variable: '--font-display',
  weight: '400 700',
  style: 'normal',
  display: 'swap',
})

export const fontSans = localFont({
  src: [
    { path: '../fonts/publicsans-variable.woff2', weight: '400 700', style: 'normal' },
    { path: '../fonts/publicsans-italic.woff2', weight: '400', style: 'italic' },
  ],
  variable: '--font-sans',
  display: 'swap',
})

export const fontMono = localFont({
  src: [
    { path: '../fonts/plexmono-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/plexmono-500.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/plexmono-600.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-mono',
  display: 'swap',
})
