import { describe, it, expect, vi, beforeEach } from 'vitest'
import { storeGmNotesForTurn } from '../worldMetaNotes'

const makeTx = () => ({
  worldMeta: {
    findUnique: vi.fn(),
    update: vi.fn(async (_args: any) => ({})),
  },
})

let tx: ReturnType<typeof makeTx>
beforeEach(() => {
  tx = makeTx()
})

describe('storeGmNotesForTurn', () => {
  it('appends a note to an empty history', async () => {
    tx.worldMeta.findUnique.mockResolvedValue({ id: 'wm1', otherMeta: null })

    await storeGmNotesForTurn(tx as any, 'camp1', 5, 'The rebels are massing north of the wall.')

    expect(tx.worldMeta.update).toHaveBeenCalledWith({
      where: { id: 'wm1' },
      data: {
        otherMeta: expect.objectContaining({
          gm_notes_history: [
            expect.objectContaining({ turn: 5, notes: 'The rebels are massing north of the wall.' }),
          ],
        }),
      },
    })
  })

  it('appends to existing history and preserves other otherMeta fields', async () => {
    tx.worldMeta.findUnique.mockResolvedValue({
      id: 'wm1',
      otherMeta: { unrelatedField: 'keep-me', gm_notes_history: [{ turn: 1, notes: 'earlier note' }] },
    })

    await storeGmNotesForTurn(tx as any, 'camp1', 2, 'new note')

    const call = tx.worldMeta.update.mock.calls[0][0]
    expect(call.data.otherMeta.unrelatedField).toBe('keep-me')
    expect(call.data.otherMeta.gm_notes_history).toHaveLength(2)
    expect(call.data.otherMeta.gm_notes_history[1].notes).toBe('new note')
  })

  it('caps history at 20 entries, dropping the oldest', async () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ turn: i, notes: `note ${i}` }))
    tx.worldMeta.findUnique.mockResolvedValue({ id: 'wm1', otherMeta: { gm_notes_history: history } })

    await storeGmNotesForTurn(tx as any, 'camp1', 20, 'the 21st note')

    const call = tx.worldMeta.update.mock.calls[0][0]
    expect(call.data.otherMeta.gm_notes_history).toHaveLength(20)
    expect(call.data.otherMeta.gm_notes_history[0].notes).toBe('note 1') // oldest (note 0) dropped
    expect(call.data.otherMeta.gm_notes_history[19].notes).toBe('the 21st note')
  })

  it('does nothing when the campaign has no WorldMeta row', async () => {
    tx.worldMeta.findUnique.mockResolvedValue(null)
    await storeGmNotesForTurn(tx as any, 'camp1', 1, 'note')
    expect(tx.worldMeta.update).not.toHaveBeenCalled()
  })
})
