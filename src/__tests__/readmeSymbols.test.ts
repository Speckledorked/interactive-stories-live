// src/__tests__/readmeSymbols.test.ts
//
// The README (and, since 2026-08-06, docs/ARCHITECTURE.md — the technical
// audit split out of the README so it could speak to players instead of
// leading with a scorecard) make claims about code, and nothing checked
// them.
//
// This file is long, it is written as a running ledger, and an entry from
// six sections ago can be quietly falsified by a later change. That is not
// hypothetical: the `#60/#61/#90` entry said `getWorldStateChanges()` "is
// restored as a real accessor" while the dead-export sweep twenty lines
// below explained why it had been removed. The file contradicted itself,
// tsc was clean, and the suite passed.
//
// #397: this line used to name a specific test count, which then sat stale
// for thousands of tests — a doc-integrity guard whose own comment had
// drifted. The number is dropped rather than corrected: a count in a
// comment is a claim nothing checks, which is the exact failure this file
// exists to prevent elsewhere. See architectureCounts.test.ts for the
// numbers that ARE checked, by deriving them from source.
//
// So: every camelCase symbol either doc names in backticks must either
// exist in the codebase, or be listed below as deliberately gone.
//
// The second half is what keeps this from rotting into a suppression
// list. A symbol on the allowlist that *comes back* also fails — so the
// list can only ever contain things that are genuinely absent, and it
// prunes itself the moment that stops being true.
//
// Adding a line here is a small cost paid at exactly the right moment:
// when you delete something either doc talks about, which is precisely
// when you should be re-reading what it says about it.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Symbols the README names in the PAST TENSE — things it describes as
 * deleted, dead, replaced, or deliberately never built. Each is a real
 * claim ("the old X is deleted"), not a stale one.
 *
 * If a name here starts existing again, this test fails and the README
 * prose about it needs re-reading before the name is removed from the
 * list.
 */
const DELIBERATELY_ABSENT: Record<string, string> = {
  // Removed with the manual world-turn trigger — the admin tick preview
  // is intentionally read-only.
  getWorldTurnSummary: 'world-turn trigger removed on purpose',

  // The dead-export sweep. Each was checked for a possible caller first;
  // see the sweep entry in the README for why none was possible.
  getWorldStateChanges: 'every consumer already holds the Scene; fetch-by-id would be an N+1',
  buildFullWorldState: 'no membership/role check — a fog-of-war bypass waiting for a caller',
  triggerSceneUpdate: "orphan of an older naming convention; scene:verb won",

  // Replaced by conditionPenalty(), which sums structured rollModifier
  // fields instead of regex-parsing prose.
  getTotalConditionPenalty: 'regex parse of mechanicalEffect, misread bidirectional conditions',

  // The keyword classifier the AI move-classifier replaced.
  extractTagsFromAction: 'keyword guesswork, replaced by the classifier',

  // AIResponseCache and its pattern-template machinery, deleted whole.
  matchPattern: 'part of the deleted response-cache pattern templates',
  skipCache: 'option became meaningless once the cache was deleted',

  // Campaign-template fields applyCampaignTemplate never read.
  defaultPerks: 'never read by applyCampaignTemplate',
  startingItems: 'never read by applyCampaignTemplate',

  // Inventory helpers that were never wired; "full" is undefined in this
  // engine, so enforcing capacity was not a clean wiring fix.
  addItemToInventory: 'never wired; inventory capacity is undefined here',
  removeItemFromInventory: 'never wired; inventory capacity is undefined here',
  findItem: 'never wired; inventory capacity is undefined here',

  // Renamed in the campaign-host reframing: "GM" now only means the AI.
  isGM: 'renamed to isHost when GM came to mean only the AI',

  // Removed with the manual world-turn trigger.
  manualWorldTurn: 'host-facing "advance the world now" surface, never connected',

  // Never existed under this name — the pc_changes applier is
  // applyCharacterChanges. Found by this very test on its first run,
  // miscredited in the #69 entry.
  applyPCChanges: 'never a real name; the pc_changes applier is applyCharacterChanges',

  // Replaced by the pure needsIntervention() in campaignHealthBands.ts —
  // every caller already has the health, so recomputing it was pointless.
  checkCampaignNeedsIntervention: 'recomputed health for a boolean no caller needed',

  // Per-template move lists, replaced by Move.baseMoveKey lookup.
  defaultMoves: 'per-template move list replaced by baseMoveKey at roll time',

  // The rest of the never-wired inventory-capacity family.
  hasInventorySpace: 'never wired; inventory capacity is undefined here',

  // Renamed to generateGmAnswer to match the generate* convention every
  // other "make an AI call, return a generated artifact" function uses.
  answerGmQuestion: 'renamed to generateGmAnswer for naming consistency',

  // #412/#413: the token-movement half of AIVisualService. All three had
  // zero callers — the `ai-character-moved`/`ai-element-added`/
  // `ai-element-removed` events they broadcast had no producer anywhere in
  // the app, so the whole path was unreachable. Removed with the per-token
  // mutation API in map-service.ts that existed only to serve them. Maps
  // in MythOS are illustrative and regenerated per scene; grid combat is
  // parked, and if it is picked up this surface gets written deliberately
  // with the authorization and broadcast story these never had.
  updateCharacterPosition: 'removed with the parked VTT token-movement path (#412)',
  addSceneElement: 'removed with the parked VTT token-movement path (#412)',
  removeSceneElement: 'removed with the parked VTT token-movement path (#412)',
}

const SEARCH_ROOTS = ['src', 'prisma']
const SEARCHABLE = /\.(ts|tsx|prisma)$/

// This file names every absent symbol in its own allowlist, so including
// it in the corpus would make all of them look alive.
const SELF = 'readmeSymbols.test.ts'

function collectSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collectSource(full, out)
    else if (SEARCHABLE.test(entry)) out.push(full)
  }
  return out
}

/**
 * Strip comments before searching, because a MENTION is not an existence.
 *
 * Removing a dead export here leaves a NOTE comment behind saying what was
 * looked for and why nothing could call it — that is the whole point of
 * those comments, and it would otherwise make every removed symbol look
 * alive to this test. `//` is only treated as a comment when it is not
 * part of `://`, so a URL in a string does not swallow the rest of its
 * line.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// One read of the whole tree, shared by every case below.
const corpus = SEARCH_ROOTS.flatMap(root => collectSource(root))
  .filter(f => !f.endsWith(SELF))
  .map(f => stripComments(readFileSync(f, 'utf8')))
  .join('\n')

// The two docs that make claims about code — kept as separate labeled
// entries, not concatenated into one blob, so the sentence-boundary check
// below never reads across a file boundary as if it were one paragraph.
const DOCS: Array<{ label: string; text: string }> = [
  { label: 'README.md', text: readFileSync('README.md', 'utf8') },
  { label: 'docs/ARCHITECTURE.md', text: readFileSync('docs/ARCHITECTURE.md', 'utf8') },
]

/**
 * Backticked camelCase identifiers, with or without trailing parens.
 *
 * Deliberately narrow. Requiring a lowercase first letter AND an
 * uppercase somewhere skips prose words, `#88`-style issue refs, snake
 * case AI fields (`harm_healing`), event names (`scene:resolved`), file
 * paths and Type Names — none of which this test can meaningfully
 * verify. A check that flags everything gets switched off.
 */
function symbolsNamedInReadme(): string[] {
  const found = new Set<string>()
  for (const { text } of DOCS) {
    for (const match of text.matchAll(/`([a-z][a-zA-Z0-9]*)\(?\)?`/g)) {
      const name = match[1]
      if (/[A-Z]/.test(name)) found.add(name)
    }
  }
  return [...found].sort()
}

const exists = (name: string) => new RegExp(`\\b${name}\\b`).test(corpus)

/**
 * Words that mark a sentence as describing something that is GONE.
 *
 * Kept broad on purpose. A false negative here costs nothing — the
 * sentence was honest anyway — while a false positive trains people to
 * ignore the check, which is how a check dies.
 */
const ABSENCE_MARKER =
  /\b(remov|delet|drop|no longer|dead|never|old|replac|was|were|had|deliberately no|instead of|used to|previously|gone|retired|renam)/i

describe('README symbol claims', () => {
  it('names symbols that actually exist, or declares them gone', () => {
    // The failure this exists for: prose asserting something is wired
    // when it was removed three commits later, in a section nobody
    // re-read.
    const phantom = symbolsNamedInReadme()
      .filter(name => !(name in DELIBERATELY_ABSENT))
      .filter(name => !exists(name))

    expect(
      phantom,
      `README.md / docs/ARCHITECTURE.md name ${phantom.length} symbol(s) that do not exist in src/ or prisma/.\n` +
      `Either the prose is stale, or the symbol was removed on purpose — if so, add it ` +
      `to DELIBERATELY_ABSENT in this file WITH the reason, and re-read what that doc ` +
      `says about it while you are there.\n  ${phantom.join('\n  ')}`
    ).toEqual([])
  })

  it('does not carry allowlist entries for symbols that came back', () => {
    // What stops this from becoming a suppression list nobody prunes. A
    // resurrected symbol means the docs' past-tense prose about it is
    // now wrong in the other direction.
    const resurrected = Object.keys(DELIBERATELY_ABSENT).filter(exists)

    expect(
      resurrected,
      `These are listed as deliberately absent but exist again. README.md / ` +
      `docs/ARCHITECTURE.md almost certainly still describe them as deleted — fix the ` +
      `prose, then drop them from DELIBERATELY_ABSENT.\n  ${resurrected.join('\n  ')}`
    ).toEqual([])
  })

  it('describes deliberately-absent symbols in the past tense, everywhere', () => {
    // The self-contradiction case, and the one that actually happened:
    // the symbol was correctly declared gone in one section while another
    // section — written earlier, never re-read — said it was "restored as
    // a real accessor". Both claims were in the same file.
    //
    // Scoped to the SENTENCE containing the mention, not a proximity
    // window. A window would find the word "removed" elsewhere in the
    // same dense paragraph and pass the very sentence that contradicts it.
    //
    // Each doc is scanned independently (not concatenated) so a sentence
    // never accidentally spans a file boundary.
    const failures: string[] = []

    for (const { label, text } of DOCS) {
      for (const name of Object.keys(DELIBERATELY_ABSENT)) {
        for (const match of text.matchAll(new RegExp('`' + name + '\\(?\\)?`', 'g'))) {
          const start = text.lastIndexOf('. ', match.index!) + 1
          const end = text.indexOf('. ', match.index! + match[0].length)
          const sentence = text.slice(start, end > 0 ? end : match.index! + 200)
          if (!ABSENCE_MARKER.test(sentence)) {
            failures.push(`${label} — ${name}: "${sentence.trim().slice(0, 120)}"`)
          }
        }
      }
    }

    expect(
      failures,
      `These sentences name a removed symbol as though it still exists. Either the ` +
      `prose is stale, or it needs wording that says the thing is gone.\n  ` +
      failures.join('\n  ')
    ).toEqual([])
  })

  it('explains every allowlist entry', () => {
    // A bare name is how the next person learns nothing and re-adds it.
    for (const [name, reason] of Object.entries(DELIBERATELY_ABSENT)) {
      expect(reason.length, `${name} needs a real reason, not a placeholder`).toBeGreaterThan(15)
    }
  })

  it('actually scans a meaningful number of symbols', () => {
    // Guards the regex itself. If a README edit or a refactor quietly
    // broke the pattern, every case above would pass vacuously by
    // checking nothing at all.
    expect(symbolsNamedInReadme().length).toBeGreaterThan(100)
    expect(corpus.length).toBeGreaterThan(500_000)
  })
})
