// src/app/api/__tests__/fogOfWar.test.ts
//
// The structural half of #94, and the part that actually lasts.
//
// Replacing 23 hand-written `isDiscovered` clauses with `visibleTo()` fixes
// today. It does nothing about the real risk, which is the route someone
// adds next year that returns NPCs and forgets. Fog of war is this
// product's headline claim and the one place drift costs a data leak rather
// than a wrong number, so it should not rest on everybody remembering.
//
// So: any route that READS a fog-gated model must either use the shared
// helper, be admin-only, or be listed below with a reason. The exemptions
// are self-policing — an exempt route may only select `id` from a gated
// model, so the moment one starts returning real entity data it fails here
// instead of leaking quietly.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { FOG_GATED_MODELS, visibleTo } from '@/lib/api/visibility'

const API_ROOT = 'src/app/api'

/**
 * Routes allowed to read a fog-gated model without the helper, with the
 * reason. Each of these resolves a name or id to check existence and never
 * returns the row — see the `select` assertion below, which is what keeps
 * that true rather than merely claimed.
 */
const EXEMPT: Record<string, string> = {
  'campaigns/[id]/characters/route.ts':
    'character creation resolves a starting-tie counterparty by name to write FactionStanding/Debt rows; selects id only, never returned. Gating on discovery would break backstory ties to factions the party has not met — which is the point of a backstory tie.',
  'campaigns/[id]/notes/route.ts':
    'validates that a note\'s referenced entity exists before linking it; selects id only, answers with 400 or nothing.',
  'campaigns/[id]/notes/[noteId]/route.ts':
    'same entity-reference validation as the collection route.',
}

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) routeFiles(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const rel = (path: string) => path.replace(`${API_ROOT}/`, '')

/**
 * Reads of a fog-gated model, by either route Prisma offers:
 *
 *  - a direct query (`prisma.nPC.findMany`), and
 *  - a nested relation on another query (`npcs: { where: ... }`).
 *
 * The second pattern is not padding. The first version of this check only
 * looked for direct queries and gave the main campaign GET a clean bill of
 * health — the single most important fog-gated route in the app, which
 * fetches all four models through `include`.
 */
const DIRECT_READ = /prisma\.(nPC|faction|location|clock)\.(findMany|findFirst|findUnique)/g
const NESTED_READ = /\b(npcs|factions|locations|clocks)\s*:\s*\{\s*(where|orderBy|select)/g

function readsGatedModel(source: string): boolean {
  return DIRECT_READ.test(source) || NESTED_READ.test(source)
}

const files = routeFiles(API_ROOT)
const gatedRoutes = files.filter(f => {
  DIRECT_READ.lastIndex = 0
  NESTED_READ.lastIndex = 0
  return readsGatedModel(readFileSync(f, 'utf8'))
})

const usesHelper = (src: string) => src.includes("from '@/lib/api/visibility'")
const isAdminOnly = (src: string) => /role\s*!==\s*'ADMIN'/.test(src)

describe('fog of war is enforced structurally, not by memory', () => {
  it('finds the routes that read fog-gated models at all', () => {
    // Guards the detector. If a refactor breaks these patterns, every case
    // below would pass vacuously by examining nothing.
    expect(gatedRoutes.length).toBeGreaterThan(5)
    expect(gatedRoutes.map(rel)).toContain('campaigns/[id]/route.ts')
  })

  it('gates every one of them, or exempts it on the record', () => {
    const unguarded = gatedRoutes
      .map(f => ({ path: rel(f), src: readFileSync(f, 'utf8') }))
      .filter(({ path }) => !(path in EXEMPT))
      .filter(({ src }) => !usesHelper(src) && !isAdminOnly(src))
      .map(({ path }) => path)

    expect(
      unguarded,
      `These routes read a fog-gated model (NPC/faction/location/clock) without ` +
      `visibleTo() from @/lib/api/visibility, and are not admin-only.\n` +
      `If the result reaches the client it must be gated. If it is an internal ` +
      `existence check, select only id and add it to EXEMPT in this file with ` +
      `the reason.\n  ${unguarded.join('\n  ')}`
    ).toEqual([])
  })

  it('holds exempt routes to reading nothing but ids', () => {
    // What stops EXEMPT becoming a place to hide a leak. An exemption is
    // "this never returns the row", so it stays true only while the reads
    // select id and nothing else.
    const leaky: string[] = []

    for (const [path, reason] of Object.entries(EXEMPT)) {
      const full = join(API_ROOT, path)
      const src = readFileSync(full, 'utf8')
      expect(reason.length, `${path} needs a real reason`).toBeGreaterThan(30)

      // Every gated read in an exempt file must be followed by an id-only
      // select within the same call.
      const calls = src.split(/prisma\.(?:nPC|faction|location|clock)\.(?:findMany|findFirst|findUnique)\(/).slice(1)
      for (const call of calls) {
        const head = call.slice(0, call.indexOf('})') + 2)
        if (!/select:\s*\{\s*id:\s*true\s*\}/.test(head)) {
          leaky.push(`${path}: a gated read without \`select: { id: true }\``)
        }
      }
    }

    expect(
      leaky,
      `An exempt route is reading more than an id from a fog-gated model. ` +
      `Either narrow the select, or gate the route properly and drop the ` +
      `exemption.\n  ${leaky.join('\n  ')}`
    ).toEqual([])
  })

  it('does not carry exemptions for routes that no longer exist', () => {
    // Self-pruning, same as the README symbol allowlist: a stale entry is a
    // hole waiting for a new file to be created at that path.
    const missing = Object.keys(EXEMPT).filter(p => !files.map(rel).includes(p))
    expect(missing, `Stale EXEMPT entries:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('leaves no hand-rolled discovery clause outside the helper', () => {
    // The point of the refactor. A route writing its own `isDiscovered:
    // true` is a route that could just as easily write `false`, or use it
    // on a clock, where the polarity is inverted.
    const handRolled = gatedRoutes
      .map(f => ({ path: rel(f), src: readFileSync(f, 'utf8') }))
      // Write paths legitimately SET these flags; only filters are at issue.
      // No `s` flag: [^}]* already spans newlines, and the flag needs a
      // newer TS target than this project compiles to. (tsc catches that;
      // Vitest transpiles and would not have.)
      .filter(({ src }) => /where[^}]*\bisDiscovered:\s*(true|false)/.test(src) ||
                           /where[^}]*\bisHidden:\s*(true|false)/.test(src))
      .map(({ path }) => path)

    expect(
      handRolled,
      `These routes filter on a discovery flag directly instead of using ` +
      `visibleTo(). The helper exists because clocks gate on isHidden while ` +
      `everything else gates on isDiscovered — opposite polarity, easy to ` +
      `copy wrong.\n  ${handRolled.join('\n  ')}`
    ).toEqual([])
  })
})

describe('visibleTo', () => {
  it('lifts the fog for an admin', () => {
    for (const model of FOG_GATED_MODELS) {
      expect(visibleTo(model, 'ADMIN')).toEqual({})
    }
  })

  it('reveals only discovered entities to a player', () => {
    expect(visibleTo('npc', 'PLAYER')).toEqual({ isDiscovered: true })
    expect(visibleTo('faction', 'PLAYER')).toEqual({ isDiscovered: true })
    expect(visibleTo('location', 'PLAYER')).toEqual({ isDiscovered: true })
  })

  it('gets the clock polarity right', () => {
    // The specific mistake this helper exists to prevent: clocks hide
    // behind isHidden, not isDiscovered, and the value that means visible
    // is false rather than true.
    expect(visibleTo('clock', 'PLAYER')).toEqual({ isHidden: false })
  })

  it('fails closed for a missing or unrecognised role', () => {
    // The failure mode of guessing generously is showing a player the GM's
    // hidden clocks.
    for (const role of [null, undefined, '', 'PLAYER', 'OWNER', 'admin']) {
      expect(visibleTo('npc', role as string), String(role)).toEqual({ isDiscovered: true })
    }
  })

  it('never returns an empty filter for a non-admin, whatever it is asked', () => {
    // The invariant underneath all of the above: {} means "no restriction",
    // and a non-admin must never receive one.
    for (const model of [...FOG_GATED_MODELS, 'nonsense' as never]) {
      expect(Object.keys(visibleTo(model, 'PLAYER')).length, String(model)).toBeGreaterThan(0)
    }
  })
})
