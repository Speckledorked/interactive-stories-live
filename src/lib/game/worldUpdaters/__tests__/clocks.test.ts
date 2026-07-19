import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyClockChanges, ClockChange } from '../clocks'
import type { Clock } from '@prisma/client'

const makeTx = () => ({
  clock: { update: vi.fn(async () => ({})) },
})

let tx: ReturnType<typeof makeTx>
beforeEach(() => {
  tx = makeTx()
})

const clock = (over: Partial<Clock> = {}): Clock =>
  ({ id: 'clock1', name: 'The Siege Tightens', currentTicks: 3, maxTicks: 6, ...over } as Clock)

describe('applyClockChanges', () => {
  it('advances ticks by the reported delta, resolving by exact id', async () => {
    const roster = [clock()]
    await applyClockChanges(tx as any, [{ clock_name_or_id: 'clock1', delta: 2 } as ClockChange], roster)
    expect(tx.clock.update).toHaveBeenCalledWith({ where: { id: 'clock1' }, data: { currentTicks: 5 } })
  })

  it('resolves by exact name when an id was not given', async () => {
    const roster = [clock()]
    await applyClockChanges(tx as any, [{ clock_name_or_id: 'the siege tightens', delta: 1 } as ClockChange], roster)
    expect(tx.clock.update).toHaveBeenCalledWith({ where: { id: 'clock1' }, data: { currentTicks: 4 } })
  })

  it('clamps ticks to the clock\'s maxTicks — never overflows', async () => {
    const roster = [clock({ currentTicks: 5, maxTicks: 6 })]
    await applyClockChanges(tx as any, [{ clock_name_or_id: 'clock1', delta: 10 } as ClockChange], roster)
    expect(tx.clock.update).toHaveBeenCalledWith({ where: { id: 'clock1' }, data: { currentTicks: 6 } })
  })

  it('clamps ticks at 0 — never goes negative', async () => {
    const roster = [clock({ currentTicks: 1 })]
    await applyClockChanges(tx as any, [{ clock_name_or_id: 'clock1', delta: -10 } as ClockChange], roster)
    expect(tx.clock.update).toHaveBeenCalledWith({ where: { id: 'clock1' }, data: { currentTicks: 0 } })
  })

  it('skips a clock that cannot be resolved rather than throwing', async () => {
    await applyClockChanges(tx as any, [{ clock_name_or_id: 'Nonexistent Clock', delta: 1 } as ClockChange], [])
    expect(tx.clock.update).not.toHaveBeenCalled()
  })

  it('does not update a clock whose name is only an ambiguous fuzzy match', async () => {
    const roster = [clock({ id: 'c1', name: 'Manston Uprising' }), clock({ id: 'c2', name: 'Marlton Uprising' })]
    await applyClockChanges(tx as any, [{ clock_name_or_id: 'Marston Uprising', delta: 1 } as ClockChange], roster)
    expect(tx.clock.update).not.toHaveBeenCalled()
  })
})
