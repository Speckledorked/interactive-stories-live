import { describe, it, expect } from 'vitest';
import { planLogConsolidation } from '../storyLogConsolidation';

describe('planLogConsolidation', () => {
  it('plans nothing for a scene with only one row', () => {
    const plans = planLogConsolidation([
      { id: 'log1', sceneId: 'scene1', turnNumber: 3, highlights: ['a'] },
    ]);
    expect(plans).toHaveLength(0);
  });

  it('plans nothing for rows with no sceneId (manually-authored entries)', () => {
    const plans = planLogConsolidation([
      { id: 'log1', sceneId: null, turnNumber: 1, highlights: [] },
      { id: 'log2', sceneId: null, turnNumber: 2, highlights: [] },
    ]);
    expect(plans).toHaveLength(0);
  });

  it('keeps the earliest row as canonical and deletes the rest for a duplicated scene', () => {
    const plans = planLogConsolidation([
      { id: 'log-turn5', sceneId: 'scene1', turnNumber: 5, highlights: ['b'] },
      { id: 'log-turn3', sceneId: 'scene1', turnNumber: 3, highlights: ['a'] },
      { id: 'log-turn7', sceneId: 'scene1', turnNumber: 7, highlights: ['c'] },
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0].canonicalId).toBe('log-turn3');
    expect(plans[0].deleteIds.sort()).toEqual(['log-turn5', 'log-turn7']);
  });

  it('merges and deduplicates highlights across the duplicated rows', () => {
    const plans = planLogConsolidation([
      { id: 'log1', sceneId: 'scene1', turnNumber: 1, highlights: ['a', 'b'] },
      { id: 'log2', sceneId: 'scene1', turnNumber: 2, highlights: ['b', 'c'] },
    ]);
    expect(plans[0].mergedHighlights).toEqual(['a', 'b', 'c']);
  });

  it('handles multiple duplicated scenes independently', () => {
    const plans = planLogConsolidation([
      { id: 'log1', sceneId: 'scene1', turnNumber: 1, highlights: [] },
      { id: 'log2', sceneId: 'scene1', turnNumber: 2, highlights: [] },
      { id: 'log3', sceneId: 'scene2', turnNumber: 1, highlights: [] },
      { id: 'log4', sceneId: 'scene2', turnNumber: 2, highlights: [] },
    ]);
    expect(plans).toHaveLength(2);
    const sceneIds = plans.map(p => p.sceneId).sort();
    expect(sceneIds).toEqual(['scene1', 'scene2']);
  });
});
