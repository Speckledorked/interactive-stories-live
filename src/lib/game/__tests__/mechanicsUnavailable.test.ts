// src/lib/game/__tests__/mechanicsUnavailable.test.ts
//
// The first test is the real incident. On 2026-08-18 a player saw
// "The dice engine was unavailable this exchange (an API issue)" while the
// logs showed the classifier call had succeeded and been billed $0.00127 —
// the model had returned `stat_key: null` and the schema layer had refused
// it. The banner sent anyone reading it to the wrong layer entirely.

import { describe, it, expect } from 'vitest'
import { mechanicsUnavailableDetails } from '../mechanicsUnavailable'

describe('the incident this wording exists for', () => {
  it('does not blame the API when the API worked and the model did not', () => {
    const details = mechanicsUnavailableDetails({
      _mechanicsUnavailable: true,
      _mechanicsUnavailableReason: 'unusable-output',
      _mechanicsDroppedFields: ['stat_key'],
    })!

    expect(details).not.toMatch(/API/i)
    expect(details).not.toMatch(/unavailable|could not be reached/i)
    // What actually happened: it ran, and its answer was refused.
    expect(details).toMatch(/ran/)
    expect(details).toMatch(/failed validation/)
    expect(details).toMatch(/rejected/)
  })

  it('names the field the model got wrong, which is the whole point', () => {
    // "is it the same field every time" is the first question anyone asks,
    // and the old message could not answer it.
    expect(
      mechanicsUnavailableDetails({
        _mechanicsUnavailable: true,
        _mechanicsUnavailableReason: 'unusable-output',
        _mechanicsDroppedFields: ['stat_key'],
      })
    ).toContain('rejected: stat_key')
  })

  it('still says the operationally important thing in every branch', () => {
    // Whatever the cause, the player needs to know this exchange had no real
    // rolls. Losing that while adding detail would be a worse bug.
    for (const reason of ['no-api-key', 'api-error', 'unusable-output'] as const) {
      expect(
        mechanicsUnavailableDetails({ _mechanicsUnavailable: true, _mechanicsUnavailableReason: reason }),
        reason
      ).toMatch(/freeform narration instead of a real roll/)
    }
  })
})

describe('each cause points somewhere different', () => {
  const detailsFor = (reason: 'no-api-key' | 'api-error' | 'unusable-output') =>
    mechanicsUnavailableDetails({ _mechanicsUnavailable: true, _mechanicsUnavailableReason: reason })!

  it('calls a missing key configuration, not a fault', () => {
    expect(detailsFor('no-api-key')).toMatch(/not configured/)
  })

  it('calls a genuine call failure unreachable', () => {
    expect(detailsFor('api-error')).toMatch(/could not be reached/)
  })

  it('gives three distinct messages, so the cause is actually distinguishable', () => {
    const all = [detailsFor('no-api-key'), detailsFor('api-error'), detailsFor('unusable-output')]
    expect(new Set(all).size).toBe(3)
  })
})

describe('field summarising', () => {
  it('does not repeat a field that failed on several actions', () => {
    const details = mechanicsUnavailableDetails({
      _mechanicsUnavailable: true,
      _mechanicsUnavailableReason: 'unusable-output',
      _mechanicsDroppedFields: ['stat_key', 'stat_key', 'stat_key'],
    })!
    expect(details.match(/stat_key/g)).toHaveLength(1)
  })

  it('lists several distinct fields readably', () => {
    expect(
      mechanicsUnavailableDetails({
        _mechanicsUnavailable: true,
        _mechanicsUnavailableReason: 'unusable-output',
        _mechanicsDroppedFields: ['stat_key', 'move_name'],
      })
    ).toContain('rejected: stat_key and move_name')

    expect(
      mechanicsUnavailableDetails({
        _mechanicsUnavailable: true,
        _mechanicsUnavailableReason: 'unusable-output',
        _mechanicsDroppedFields: ['a', 'b', 'c'],
      })
    ).toContain('rejected: a, b and c')
  })

  it('omits the parenthetical entirely when no field was captured', () => {
    const details = mechanicsUnavailableDetails({
      _mechanicsUnavailable: true,
      _mechanicsUnavailableReason: 'unusable-output',
      _mechanicsDroppedFields: [],
    })!
    expect(details).not.toContain('rejected:')
    expect(details).not.toContain('()')
  })
})

describe('silence and degradation', () => {
  it('says nothing when the dice engine ran normally', () => {
    expect(mechanicsUnavailableDetails({})).toBeNull()
    expect(mechanicsUnavailableDetails({ _mechanicsUnavailable: false })).toBeNull()
  })

  it('invents no cause for a scene resolved before the reason was recorded', () => {
    // Older scenes have the flag and no reason. Claiming one would repeat
    // exactly the mistake this module fixes.
    const details = mechanicsUnavailableDetails({ _mechanicsUnavailable: true })!
    expect(details).toMatch(/did not run/)
    expect(details).not.toMatch(/API|not configured|failed validation/i)
  })
})
