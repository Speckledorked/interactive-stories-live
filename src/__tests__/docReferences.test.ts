// src/__tests__/docReferences.test.ts
// #424: a citation from code into the docs has to land somewhere.
//
// `readmeSymbols.test.ts` checks that backticked SYMBOLS named in the docs
// exist in the source. This is the other direction, and it was unguarded:
// comments in the source that cite a DOC SECTION, with nothing verifying
// the section is there.
//
// It went wrong exactly the way an unguarded thing does. `CONTRIBUTING.md`
// sanctioned citing "a README Priority List or Known Bugs entry", so 22
// comments across 21 files cited `README Known Bugs` — a section that has
// never existed in this repository's tracked history. README is a setup
// and quickstart document; the Priority List and Fix Log are in
// `docs/ARCHITECTURE.md`. Every one of those citations was written in good
// faith by someone following the convention, and every one led nowhere.
//
// The cost is subtle, which is why it survived: the comments' CONTENT was
// accurate — real bugs, really fixed. What was lost is the ability to
// check that. A breadcrumb trail that ends in nothing is worse than no
// trail, because it costs a search before it fails.
//
// ── What this checks ──────────────────────────────────────────────────────
//
// Any comment naming a doc file plus a section — "see docs/ARCHITECTURE.md's
// Fix Log", "README Known Bugs", "the Priority List in ARCHITECTURE.md" —
// must name a section that document actually has. Deliberately narrow:
// it only fires on a KNOWN doc filename followed by a plausible section
// name, so ordinary prose can't trip it.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')

/** The docs that carry sections worth citing, and their headings. */
const DOCS = ['README.md', 'CONTRIBUTING.md', 'SETUP.md', 'docs/ARCHITECTURE.md', 'docs/MIGRATIONS.md', 'docs/design-system.md']

function headingsOf(relativePath: string): string[] {
  const text = readFileSync(join(REPO_ROOT, relativePath), 'utf8')
  const headings: string[] = []
  for (const line of text.split('\n')) {
    // Markdown headings, plus the plain-text lead-ins this repo also uses
    // as de-facto section titles ("Partial or weak, and honestly so:").
    const hash = line.match(/^#{1,6}\s+(.*?)\s*$/)
    if (hash) headings.push(hash[1])
    const leadIn = line.match(/^([A-Z][^.!?]{4,60}):\s*$/)
    if (leadIn) headings.push(leadIn[1])
  }
  return headings
}

/** Every heading across every doc, lowercased for comparison. */
const ALL_HEADINGS = new Set(
  DOCS.flatMap((doc) => headingsOf(doc)).map((h) => h.toLowerCase().replace(/[`*]/g, ''))
)

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

// This file names the very citations it forbids, so scanning itself would
// make every example look like a live violation.
const SELF = 'docReferences.test.ts'

const DOC = String.raw`(?:README|CONTRIBUTING|SETUP|ARCHITECTURE|MIGRATIONS)(?:\.md)?(?:'s)?`

/**
 * The two grammars a real citation actually uses. Both are needed, and
 * finding that out is the reason this comment is here.
 *
 * LEADING — "README Known Bugs", "docs/ARCHITECTURE.md's Fix Log". The
 * first version of this guard had only this one. It found four dangling
 * citations a `grep "Known Bugs"` had missed, so it looked finished.
 *
 * TRAILING — "Known Bugs P0 — see README". Mutation-testing the guard,
 * by reintroducing the exact citation from `entityResolution.ts` that
 * motivated the whole issue, showed the leading-only version sailed
 * straight past it. The guard would have shipped blind to its own
 * founding example.
 *
 * The obvious fix — scan a window on both sides for any Title Case run —
 * was tried and abandoned: it flagged ~30 false positives (`WorldEvent`,
 * `VAPID`, `GET`, every capitalised word near the word "README" in this
 * file's own siblings). A guard that noisy gets deleted, so precision
 * here is not fastidiousness, it is the difference between a guard that
 * survives and one that doesn't.
 */
const LEADING = new RegExp(String.raw`\b${DOC}\s+((?:[A-Z][A-Za-z-]*\s*){1,4})`, 'g')
const TRAILING = new RegExp(
  String.raw`\b([A-Z][A-Za-z-]*(?:\s+[A-Z][A-Za-z-]*){0,3})\s*(?:P\d\b)?\s*(?:[—,-]\s*)?see\s+${DOC}`,
  'g'
)

/** Words that follow a doc name in ordinary prose, not as a section name. */
const NOT_A_SECTION = new Set([
  'md', 'and', 'or', 'for', 'the', 'a', 'an', 'is', 'as', 'in', 'at', 'to',
  'this', 'that', 'it', 'its', 'they', 'see', 'file', 'files', 'doc', 'docs',
])

function citationsIn(source: string): string[] {
  const found: string[] = []
  for (const pattern of [LEADING, TRAILING]) {
    for (const match of source.matchAll(pattern)) {
      const section = match[1].trim().replace(/\s+/g, ' ')
      if (!section || NOT_A_SECTION.has(section.toLowerCase())) continue
      found.push(section)
    }
  }
  return found
}

describe('doc section references from code resolve (#424)', () => {
  it('names only sections the docs actually have', () => {
    const offenders: string[] = []

    for (const file of sourceFiles(join(REPO_ROOT, 'src'))) {
      if (file.endsWith(SELF)) continue
      for (const section of citationsIn(readFileSync(file, 'utf8'))) {
        const normalized = section.toLowerCase().replace(/[`*]/g, '')
        // Accept an exact heading, or a heading that starts with it —
        // "Fix Log" should match "## Fix Log", and a citation naming a
        // longer heading's opening words is still findable by a reader.
        const resolves = [...ALL_HEADINGS].some(
          (h) => h === normalized || h.startsWith(normalized) || normalized.startsWith(h)
        )
        if (!resolves) {
          offenders.push(`${file.replace(REPO_ROOT + '/', '')}: "${section}"`)
        }
      }
    }

    expect(
      offenders,
      `These comments cite a doc section that does not exist. This is how #424 happened: ` +
        `CONTRIBUTING.md sanctioned citing "README Known Bugs", 22 comments followed the ` +
        `convention, and the section had never existed. Either fix the citation to name a ` +
        `real heading, cite the underlying issue number instead, or add the section.\n  ` +
        offenders.join('\n  ')
    ).toEqual([])
  })

  it('CONTRIBUTING.md only sanctions citation targets that exist', () => {
    // The root cause, guarded directly: the convention doc is what taught
    // 22 comments to point at nothing.
    const contributing = readFileSync(join(REPO_ROOT, 'CONTRIBUTING.md'), 'utf8')

    for (const section of citationsIn(contributing)) {
      const normalized = section.toLowerCase().replace(/[`*]/g, '')
      const resolves = [...ALL_HEADINGS].some(
        (h) => h === normalized || h.startsWith(normalized) || normalized.startsWith(h)
      )
      expect(resolves, `CONTRIBUTING.md offers "${section}" as a citation target; no doc has that section`).toBe(true)
    }
  })
})
