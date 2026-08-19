// src/lib/game/consequenceRecords.ts
//
// Character.consequences entries as records that can be RETIRED, rather than
// bare strings that can only be appended or destroyed.
//
// ## The defect
//
// consequences was `{ promises?: string[], enemies?: string[],
// longTermThreats?: string[], ... }`. A plain string has no identity and no
// status, so the only two operations expressible were "append" and "splice
// out". There was no third state, which had two consequences:
//
//   - Threats accumulated. A player watched the list grow all campaign with
//     nothing ever leaving it, because leaving required the AI to report an
//     exact-ish removal AND the entry to be deleted outright.
//   - When one WAS removed it vanished. "The Ironveil contract that hunted
//     you for six sessions is over" became indistinguishable from "that never
//     happened", which is the same class of loss as deleting a resolved
//     condition instead of keeping it as history (#173).
//
// A retired threat is not the absence of a threat. It is a thing the
// character survived, and the sheet should be able to say so.
//
// ## Reading both shapes
//
// Every existing campaign has string arrays on disk. normalizeConsequenceList
// accepts either shape, so readers work before the backfill lands and keep
// working for anything written by an older deployment — the same tolerance
// the drift incident taught us to build in rather than assume a migration
// reached everywhere.

export type ConsequenceStatus = 'active' | 'resolved'

export interface ConsequenceRecord {
  text: string
  status: ConsequenceStatus
  /** Simulation turn it was incurred, when known. */
  since?: number
  /** Simulation turn it stopped applying. Only set when resolved. */
  resolvedAt?: number
}

function isRecord(value: unknown): value is ConsequenceRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ConsequenceRecord).text === 'string'
  )
}

/**
 * One array of consequences, whatever shape it is stored in.
 *
 * A legacy string is read as ACTIVE, which is the only honest reading: the
 * old format could not express resolution, so everything it holds is
 * something nobody has said is over.
 */
export function normalizeConsequenceList(raw: unknown): ConsequenceRecord[] {
  if (!Array.isArray(raw)) return []
  const out: ConsequenceRecord[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const text = entry.trim()
      if (text) out.push({ text, status: 'active' })
      continue
    }
    if (isRecord(entry)) {
      const text = entry.text.trim()
      if (!text) continue
      out.push({
        text,
        status: entry.status === 'resolved' ? 'resolved' : 'active',
        ...(typeof entry.since === 'number' ? { since: entry.since } : {}),
        ...(typeof entry.resolvedAt === 'number' ? { resolvedAt: entry.resolvedAt } : {}),
      })
    }
  }
  return out
}

export function activeOf(list: ConsequenceRecord[]): ConsequenceRecord[] {
  return list.filter((r) => r.status === 'active')
}

export function resolvedOf(list: ConsequenceRecord[]): ConsequenceRecord[] {
  return list.filter((r) => r.status === 'resolved')
}

/** The plain strings a prompt or summary should see — active only. */
export function activeTexts(raw: unknown): string[] {
  return activeOf(normalizeConsequenceList(raw)).map((r) => r.text)
}

/**
 * Retire an entry in place, returning a new list.
 *
 * Marking rather than splicing is the point of this module. An already
 * resolved entry is left exactly as it was, so a second report of the same
 * resolution cannot rewrite the turn it ended on.
 */
export function retireAt(list: ConsequenceRecord[], index: number, turn?: number): ConsequenceRecord[] {
  if (index < 0 || index >= list.length) return list
  const target = list[index]
  if (target.status === 'resolved') return list
  const next = [...list]
  next[index] = {
    ...target,
    status: 'resolved',
    ...(typeof turn === 'number' ? { resolvedAt: turn } : {}),
  }
  return next
}

/**
 * Add an entry unless an ACTIVE one already says the same thing.
 *
 * Deliberately does not dedupe against resolved entries: a threat that ended
 * and later returned is a real event, and collapsing it into the old record
 * would claim it never stopped.
 */
export function addRecord(list: ConsequenceRecord[], text: string, turn?: number): ConsequenceRecord[] {
  const clean = text.trim()
  if (!clean) return list
  const already = list.some((r) => r.status === 'active' && r.text.trim().toLowerCase() === clean.toLowerCase())
  if (already) return list
  return [...list, { text: clean, status: 'active', ...(typeof turn === 'number' ? { since: turn } : {}) }]
}
