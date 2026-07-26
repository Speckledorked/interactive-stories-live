// src/lib/game/__tests__/campaignHealthScale.test.ts
//
// Campaign scale reaching the one health surface anyone looks at.
//
// There were THREE overlapping notions of "this campaign is getting
// unwieldy": assessCampaignHealth (contextManager), suggestStoppingPoints
// (campaign-health), and calculateHealth — which is the only one a GM ever
// sees, and the only one with no notion of size at all. The first two were
// never called. A campaign with 120 scenes and 60 NPCs, straining the
// context window every turn, could report a clean bill of health.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const counts = { scene: 0, character: 0, nPC: 0, faction: 0 }

vi.mock('@/lib/prisma', () => ({
  prisma: {
    worldMeta: { findUnique: vi.fn(async () => null) },
    scene: {
      count: vi.fn(async () => counts.scene),
      findMany: vi.fn(async () => []),
    },
    character: { count: vi.fn(async () => counts.character) },
    nPC: { count: vi.fn(async () => counts.nPC) },
    faction: { count: vi.fn(async () => counts.faction) },
    campaignMembership: { count: vi.fn(async () => 3) },
  },
}))

import { CampaignHealthMonitor } from '../campaign-health'

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(counts, { scene: 5, character: 3, nPC: 4, faction: 2 })
})

const health = () => new CampaignHealthMonitor('camp1').calculateHealth()

describe('calculateHealth — scale folded in', () => {
  it('says nothing about size for a small campaign', async () => {
    const h = await health()
    expect(h.recommendations.some(r => /scene|NPC|player character/i.test(r))).toBe(false)
  })

  it('advises on a large campaign without calling it broken', async () => {
    // 50+ scenes is guidance, not a fault. A long-running game is a
    // success, and flagging it as an issue would push healthy campaigns
    // over the intervention threshold for the crime of lasting.
    counts.scene = 60
    const h = await health()
    expect(h.recommendations.join(' ')).toMatch(/compress older scenes|summary review/i)
    expect(h.issues.join(' ')).not.toMatch(/60 scenes/)
  })

  it('escalates a critically oversized campaign to a real issue', async () => {
    counts.scene = 120
    const h = await health()
    expect(h.issues.join(' ')).toMatch(/120 scenes/)
  })

  it('warns about entity counts that strain the context window', async () => {
    counts.nPC = 80
    const h = await health()
    expect(h.recommendations.join(' ')).toMatch(/NPCs\/factions|archiving inactive/i)
  })

  it('does not repeat advice the two merged systems both gave', async () => {
    // assessCampaignHealth and suggestStoppingPoints overlapped on the
    // "50+ scenes" case; a GM should not read the same sentence twice.
    counts.scene = 120
    const h = await health()
    expect(new Set(h.recommendations).size).toBe(h.recommendations.length)
    expect(new Set(h.issues).size).toBe(h.issues.length)
  })

  it('still reports the real metrics when scale gathering throws', async () => {
    // Scale advice rides on top of the actual health metrics. Losing it
    // must not cost the health check itself.
    const { prisma } = await import('@/lib/prisma')
    ;(prisma.scene.count as any).mockRejectedValueOnce(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    const h = await health()

    expect(h.score).toBeGreaterThanOrEqual(0)
    expect(h.metrics).toBeDefined()
    err.mockRestore()
  })
})

describe('checkAIConsistency — degraded responses are not successes', () => {
  it('scores a campaign falling through to emergency templates far below one that is not', async () => {
    // `success` alone read 100 here: an emergency-template response still
    // returns successfully, so the metric was blind to the exact failure
    // it exists to measure.
    const { prisma } = await import('@/lib/prisma')
    const history = (level: string) =>
      Array.from({ length: 10 }, () => ({ success: true, validationLevel: level }))

    ;(prisma.worldMeta.findUnique as any).mockResolvedValue({
      aiMetrics: { requestHistory: history('emergency') },
    })
    const degraded = await health()

    ;(prisma.worldMeta.findUnique as any).mockResolvedValue({
      aiMetrics: { requestHistory: history('full') },
    })
    const intact = await health()

    expect(degraded.metrics.aiConsistency).toBeLessThan(intact.metrics.aiConsistency)
    expect(intact.metrics.aiConsistency).toBe(100)
  })

  it('does not retroactively penalize history written before the field existed', async () => {
    // A scoring change must not invent a decline that never happened.
    const { prisma } = await import('@/lib/prisma')
    ;(prisma.worldMeta.findUnique as any).mockResolvedValue({
      aiMetrics: { requestHistory: Array.from({ length: 10 }, () => ({ success: true })) },
    })
    const h = await health()
    expect(h.metrics.aiConsistency).toBe(100)
  })

  it('still counts an outright failure as a failure', async () => {
    const { prisma } = await import('@/lib/prisma')
    ;(prisma.worldMeta.findUnique as any).mockResolvedValue({
      aiMetrics: {
        requestHistory: Array.from({ length: 10 }, (_, i) => ({ success: i < 5, validationLevel: 'full' })),
      },
    })
    const h = await health()
    expect(h.metrics.aiConsistency).toBe(50)
  })
})

describe('checkAIConsistency — outcome adherence (#93)', () => {
  const history = (extra: Record<string, unknown>) =>
    Array.from({ length: 10 }, () => ({ success: true, validationLevel: 'full', ...extra }))

  it('scores a narrator that ignores the dice below one that honors them', async () => {
    // Well-formedness and obedience are different things. A response can
    // validate perfectly and still narrate a triumph on every MISS.
    const { prisma } = await import('@/lib/prisma')

    ;(prisma.worldMeta.findUnique as any).mockResolvedValue({
      aiMetrics: { requestHistory: history({ outcomeChecked: 2, outcomeMismatches: 2 }) },
    })
    const ignoring = await health()

    ;(prisma.worldMeta.findUnique as any).mockResolvedValue({
      aiMetrics: { requestHistory: history({ outcomeChecked: 2, outcomeMismatches: 0 }) },
    })
    const honoring = await health()

    expect(ignoring.metrics.aiConsistency).toBeLessThan(honoring.metrics.aiConsistency)
    expect(honoring.metrics.aiConsistency).toBe(100)
  })

  it('dents rather than erases a response that was otherwise fine', async () => {
    // A bad exchange should cost something without wiping out a response
    // that validated cleanly and got most of its actions right.
    const { prisma } = await import('@/lib/prisma')
    ;(prisma.worldMeta.findUnique as any).mockResolvedValue({
      aiMetrics: { requestHistory: history({ outcomeChecked: 4, outcomeMismatches: 4 }) },
    })
    const h = await health()
    expect(h.metrics.aiConsistency).toBeGreaterThanOrEqual(50)
    expect(h.metrics.aiConsistency).toBeLessThan(100)
  })

  it('leaves history written before the check existed untouched', async () => {
    // Same rule as validationLevel: a scoring change must not invent a
    // decline that never happened.
    const { prisma } = await import('@/lib/prisma')
    ;(prisma.worldMeta.findUnique as any).mockResolvedValue({
      aiMetrics: { requestHistory: history({}) },
    })
    expect((await health()).metrics.aiConsistency).toBe(100)
  })

  it('ignores a malformed or zero check count rather than dividing by it', async () => {
    const { prisma } = await import('@/lib/prisma')
    ;(prisma.worldMeta.findUnique as any).mockResolvedValue({
      aiMetrics: { requestHistory: history({ outcomeChecked: 0, outcomeMismatches: 3 }) },
    })
    const zero = await health()

    ;(prisma.worldMeta.findUnique as any).mockResolvedValue({
      aiMetrics: { requestHistory: history({ outcomeChecked: 'two', outcomeMismatches: NaN }) },
    })
    const junk = await health()

    expect(zero.metrics.aiConsistency).toBe(100)
    expect(junk.metrics.aiConsistency).toBe(100)
  })
})
