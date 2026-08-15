// src/lib/game/tick/__tests__/capOrdering.test.ts
// #283: the shared rotation ordering/bump helpers every entity-cap tick
// handler now goes through.

import { describe, it, expect, vi } from 'vitest'
import { TICK_ROTATION_ORDER, markFactionsTicked, markNpcsTicked } from '../capOrdering'

describe('TICK_ROTATION_ORDER', () => {
  it('sorts ascending with nulls first — an untouched entity is maximally overdue', () => {
    expect(TICK_ROTATION_ORDER).toEqual({ lastTickedAt: { sort: 'asc', nulls: 'first' } })
  })
})

describe('markFactionsTicked', () => {
  it('bumps lastTickedAt for exactly the given ids', async () => {
    const updateMany = vi.fn(async () => ({ count: 2 }))
    await markFactionsTicked({ faction: { updateMany } }, ['f1', 'f2'])

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['f1', 'f2'] } },
      data: { lastTickedAt: expect.any(Date) },
    })
  })

  it('does not query at all for an empty selection', async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }))
    await markFactionsTicked({ faction: { updateMany } }, [])

    expect(updateMany).not.toHaveBeenCalled()
  })
})

describe('markNpcsTicked', () => {
  it('bumps lastTickedAt for exactly the given ids', async () => {
    const updateMany = vi.fn(async () => ({ count: 2 }))
    await markNpcsTicked({ nPC: { updateMany } }, ['n1', 'n2'])

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['n1', 'n2'] } },
      data: { lastTickedAt: expect.any(Date) },
    })
  })

  it('does not query at all for an empty selection', async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }))
    await markNpcsTicked({ nPC: { updateMany } }, [])

    expect(updateMany).not.toHaveBeenCalled()
  })
})
