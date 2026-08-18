// scripts/__tests__/migrationImmutability.test.ts
//
// Tested from the failing side, with the real incident as the first fixture:
// a migration file that three later commits appended to after production had
// already applied it.

import { describe, it, expect } from 'vitest'
import { findViolations, findStaleAllowances, KNOWN_EDITED } from '../migrationImmutability'

const clean = [
  { name: '20260815060000_memory_creation_failure', commits: ['a1'] },
  { name: '20260817210000_drop_dead_tutorial_tables', commits: ['b2'] },
]

describe('the incident this check exists for', () => {
  it('flags a migration edited after the commit that introduced it', () => {
    const edited = [{ name: '20260901000000_something', commits: ['c3', 'b2', 'a1'] }]

    const violations = findViolations(edited, {})

    expect(violations).toHaveLength(1)
    expect(violations[0].commitCount).toBe(3)
    expect(violations[0].reason).toMatch(/edited after the commit that introduced it/)
  })

  it('is silent on migrations touched by exactly one commit', () => {
    expect(findViolations(clean, {})).toEqual([])
  })

  it('is silent on a file with no history rather than crashing', () => {
    // A migration staged but not yet committed has zero commits. That is not
    // an immutability violation — it has never been merged, let alone applied.
    expect(findViolations([{ name: 'x', commits: [] }], {})).toEqual([])
  })
})

describe('the recorded historical exceptions', () => {
  it('tolerates a known-edited migration at exactly its recorded commit count', () => {
    const histories = [
      { name: '20260816090000_world_turn_integrity', commits: ['d', 'c', 'b', 'a'] },
      { name: '20260816140000_capability_prerequisite_dag', commits: ['f', 'e'] },
    ]
    expect(findViolations(histories)).toEqual([])
  })

  it('FAILS when a known-edited migration is edited AGAIN', () => {
    // The allowance is a specific commit count, not a blanket exemption —
    // otherwise recording an exception would license unlimited further edits
    // to the one file that has already proven it can break production.
    const histories = [
      { name: '20260816090000_world_turn_integrity', commits: ['e', 'd', 'c', 'b', 'a'] },
    ]

    const violations = findViolations(histories)

    expect(violations).toHaveLength(1)
    expect(violations[0].reason).toMatch(/5 commits now, 4 recorded/)
  })

  it('records a reason for every exception, not just a name', () => {
    for (const [name, entry] of Object.entries(KNOWN_EDITED)) {
      expect(entry.note.length, `${name} has no explanation`).toBeGreaterThan(60)
      expect(entry.commits).toBeGreaterThan(1)
    }
  })

  it('names the repair migration that replayed the lost statements', () => {
    // The allowlist entry is the only place someone reading this file will
    // learn the tail was replayed rather than abandoned.
    expect(KNOWN_EDITED['20260816090000_world_turn_integrity'].note).toContain(
      '20260817230000_repair_world_turn_integrity_tail'
    )
  })
})

describe('the allowlist prunes itself', () => {
  it('reports an entry whose file stopped being edited', () => {
    const histories = [{ name: '20260816090000_world_turn_integrity', commits: ['a'] }]
    expect(findStaleAllowances(histories, KNOWN_EDITED).join(' ')).toMatch(
      /world_turn_integrity: recorded 4 commits, now 1/
    )
  })

  it('reports an entry whose migration no longer exists', () => {
    expect(findStaleAllowances([], { gone: { commits: 2, note: 'x'.repeat(70) } })).toEqual([
      'gone: no longer present in prisma/migrations',
    ])
  })

  it('is silent when every recorded exception still holds', () => {
    const histories = [
      { name: '20260816090000_world_turn_integrity', commits: ['d', 'c', 'b', 'a'] },
      { name: '20260816140000_capability_prerequisite_dag', commits: ['f', 'e'] },
    ]
    expect(findStaleAllowances(histories)).toEqual([])
  })
})
