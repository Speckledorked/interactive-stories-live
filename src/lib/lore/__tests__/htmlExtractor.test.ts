// src/lib/lore/__tests__/htmlExtractor.test.ts
import { describe, it, expect } from 'vitest'
import { extractFromHtml } from '../htmlExtractor'

describe('extractFromHtml', () => {
  it('extracts title and body text, stripping scripts/nav/footer', () => {
    const html = `
      <html><head><title>Page Title</title></head>
      <body>
        <nav>Home | About</nav>
        <script>trackStuff()</script>
        <h1>The Sundered Veil</h1>
        <p>A world torn between essence users and the mundane.</p>
        <footer>Copyright 2026</footer>
      </body></html>
    `
    const result = extractFromHtml(html)
    expect(result.title).toBe('The Sundered Veil')
    expect(result.text).toContain('A world torn between essence users and the mundane.')
    expect(result.text).not.toContain('trackStuff')
    expect(result.text).not.toContain('Home | About')
    expect(result.text).not.toContain('Copyright 2026')
  })

  it('falls back to <title> when there is no h1', () => {
    const html = '<html><head><title>Fallback Title</title></head><body><p>Body text.</p></body></html>'
    const result = extractFromHtml(html)
    expect(result.title).toBe('Fallback Title')
  })

  it('falls back to the provided fallbackTitle when neither h1 nor title exist', () => {
    const html = '<html><body><p>Just some text.</p></body></html>'
    const result = extractFromHtml(html, 'My Fallback')
    expect(result.title).toBe('My Fallback')
  })

  it('prefers MediaWiki main content container over the rest of the page', () => {
    const html = `
      <html><body>
        <div class="sidebar">Random wiki chrome</div>
        <div id="mw-content-text"><p>Actual wiki article content.</p></div>
      </body></html>
    `
    const result = extractFromHtml(html)
    expect(result.text).toContain('Actual wiki article content.')
    expect(result.text).not.toContain('Random wiki chrome')
  })

  it('collapses excess whitespace and blank lines', () => {
    const html = '<body><p>Line one.</p>\n\n\n\n<p>Line   two.</p></body>'
    const result = extractFromHtml(html)
    expect(result.text).not.toMatch(/\n{3,}/)
    expect(result.text).toContain('Line one.')
    expect(result.text).toContain('Line two.')
  })
})
