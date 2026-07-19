import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyBargainOffers, BargainOffer } from '../bargainOffers'
import { MAX_CORRUPTION, CorruptionTheme } from '../../corruption'

const makeTx = () => ({
  character: {
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
})

const theme: CorruptionTheme = { name: 'The Hunger', stages: [] } as unknown as CorruptionTheme

let tx: ReturnType<typeof makeTx>
beforeEach(() => {
  tx = makeTx()
})

describe('applyBargainOffers', () => {
  it('does nothing if the campaign has no corruption theme (getter returns null)', async () => {
    const getCorruptionTheme = vi.fn().mockResolvedValue(null)
    await applyBargainOffers(tx as any, 'camp1', 4, [
      { character_name_or_id: 'Jason', offer: 'Take the power, lose a piece of yourself' } as BargainOffer,
    ], getCorruptionTheme)
    expect(tx.character.findFirst).not.toHaveBeenCalled()
  })

  it('offers a bargain to a resolvable, not-fully-consumed character', async () => {
    tx.character.findFirst.mockResolvedValue({ id: 'char1', name: 'Jason', corruption: 2 })
    const getCorruptionTheme = vi.fn().mockResolvedValue(theme)

    await applyBargainOffers(tx as any, 'camp1', 4, [
      { character_name_or_id: 'Jason', offer: 'Take the power, lose a piece of yourself' } as BargainOffer,
    ], getCorruptionTheme)

    expect(tx.character.update).toHaveBeenCalledWith({
      where: { id: 'char1' },
      data: { pendingBargain: { offer: 'Take the power, lose a piece of yourself', offeredTurn: 4 } },
    })
  })

  it('never offers a bargain to an already-fully-consumed character', async () => {
    tx.character.findFirst.mockResolvedValue({ id: 'char1', name: 'Jason', corruption: MAX_CORRUPTION })
    const getCorruptionTheme = vi.fn().mockResolvedValue(theme)

    await applyBargainOffers(tx as any, 'camp1', 4, [
      { character_name_or_id: 'Jason', offer: 'One more deal' } as BargainOffer,
    ], getCorruptionTheme)

    expect(tx.character.update).not.toHaveBeenCalled()
  })

  it('skips an offer with no character_name_or_id or no offer text', async () => {
    const getCorruptionTheme = vi.fn().mockResolvedValue(theme)
    await applyBargainOffers(tx as any, 'camp1', 4, [
      { character_name_or_id: '', offer: 'x' } as BargainOffer,
      { character_name_or_id: 'Jason', offer: '' } as BargainOffer,
    ], getCorruptionTheme)
    expect(tx.character.findFirst).not.toHaveBeenCalled()
  })

  it('calls the corruption-theme getter at most once even with multiple offers', async () => {
    tx.character.findFirst.mockResolvedValue({ id: 'char1', name: 'Jason', corruption: 0 })
    const getCorruptionTheme = vi.fn().mockResolvedValue(theme)

    await applyBargainOffers(tx as any, 'camp1', 4, [
      { character_name_or_id: 'Jason', offer: 'first' } as BargainOffer,
      { character_name_or_id: 'Jason', offer: 'second' } as BargainOffer,
    ], getCorruptionTheme)

    expect(getCorruptionTheme).toHaveBeenCalledTimes(1)
  })
})
