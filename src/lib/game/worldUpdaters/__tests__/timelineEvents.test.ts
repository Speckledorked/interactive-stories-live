import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyTimelineEventChanges, TimelineEventChange } from '../timelineEvents'

const makeTx = () => ({
  timelineEvent: { create: vi.fn(async ({ data }: any) => data) },
})

let tx: ReturnType<typeof makeTx>
beforeEach(() => {
  tx = makeTx()
})

describe('applyTimelineEventChanges', () => {
  it('creates one timeline event per entry with the campaign/turn stamped on', async () => {
    const events: TimelineEventChange[] = [
      {
        title: 'The bridge falls',
        summary_public: 'The old bridge collapsed in the storm.',
        summary_gm: 'Sabotaged by the Ashen Circle.',
        is_offscreen: false,
        visibility: 'PUBLIC',
      } as TimelineEventChange,
    ]

    await applyTimelineEventChanges(tx as any, 'camp1', 7, events)

    expect(tx.timelineEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: 'camp1',
        turnNumber: 7,
        title: 'The bridge falls',
        summaryPublic: 'The old bridge collapsed in the storm.',
        summaryGM: 'Sabotaged by the Ashen Circle.',
        isOffscreen: false,
        visibility: 'PUBLIC',
      }),
    })
  })

  it('uppercases visibility regardless of the case the AI sent', async () => {
    const events: TimelineEventChange[] = [
      {
        title: 'A secret kept',
        summary_public: '',
        summary_gm: 'gm-only',
        is_offscreen: true,
        visibility: 'GM_ONLY',
      } as TimelineEventChange,
    ]

    await applyTimelineEventChanges(tx as any, 'camp1', 3, events)

    expect(tx.timelineEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ visibility: 'GM_ONLY' }) })
    )
  })

  it('creates nothing for an empty list', async () => {
    await applyTimelineEventChanges(tx as any, 'camp1', 1, [])
    expect(tx.timelineEvent.create).not.toHaveBeenCalled()
  })
})
