// #201: a corrupted or hand-edited campaign export can plant a Move row
// whose `outcomes` isn't even an object (null, a string, an array...).
// resolution.ts's rolling path used to index straight into that value —
// this pins that importMoves sanitizes on the way in, so a bad row can
// never reach the DB in a shape that crashes dice mechanics later.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { create: vi.fn() },
    move: { create: vi.fn() },
  },
}));

vi.mock('@/lib/game/worldStateChanges', () => ({
  extractWorldStateChanges: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { CampaignExporter } from '../campaign-exporter';

describe('CampaignExporter.importCampaign — moves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.campaign.create).mockResolvedValue({ id: 'camp1' } as any);
  });

  const baseData = (moves: any[]) => ({
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    campaign: { title: 'Test', description: '', universe: 'Fantasy' },
    moves,
  });

  it.each([
    ['null', null],
    ['a string', 'not an object'],
    ['an array', ['strongHit', 'weakHit', 'miss']],
    ['a number', 42],
  ])('sanitizes outcomes that are %s instead of writing it straight through', async (_label, malformed) => {
    await CampaignExporter.importCampaign(
      baseData([{ name: 'Act Under Fire', trigger: 'When you...', description: 'd', rollType: 'roll+cool', outcomes: malformed, category: 'basic', isActive: true }]) as any,
      'user1'
    );

    expect(prisma.move.create).toHaveBeenCalledTimes(1);
    const written = vi.mocked(prisma.move.create).mock.calls[0][0].data as any;
    expect(written.outcomes).toEqual({});
  });

  it('drops non-string band values but keeps the valid ones', async () => {
    await CampaignExporter.importCampaign(
      baseData([{ name: 'Act Under Fire', trigger: 't', description: 'd', rollType: 'roll+cool', outcomes: { strongHit: 'Clean win.', weakHit: 42, miss: null }, category: 'basic', isActive: true }]) as any,
      'user1'
    );

    const written = vi.mocked(prisma.move.create).mock.calls[0][0].data as any;
    expect(written.outcomes).toEqual({ strongHit: 'Clean win.' });
  });

  it('passes a well-formed outcomes object through unchanged', async () => {
    const outcomes = { strongHit: 'a', weakHit: 'b', miss: 'c' };
    await CampaignExporter.importCampaign(
      baseData([{ name: 'Act Under Fire', trigger: 't', description: 'd', rollType: 'roll+cool', outcomes, category: 'basic', isActive: true }]) as any,
      'user1'
    );

    const written = vi.mocked(prisma.move.create).mock.calls[0][0].data as any;
    expect(written.outcomes).toEqual(outcomes);
  });
});
