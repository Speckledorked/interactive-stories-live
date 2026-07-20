import { describe, it, expect } from 'vitest';
import { isMilestoneTurn, CAMPAIGN_MILESTONE_INTERVAL } from '../campaignMilestone';

describe('isMilestoneTurn', () => {
  it('is false for a count of 0 (no scenes yet)', () => {
    expect(isMilestoneTurn(0)).toBe(false);
  });

  it('is false for a count that is not a multiple of the interval', () => {
    expect(isMilestoneTurn(CAMPAIGN_MILESTONE_INTERVAL - 1)).toBe(false);
    expect(isMilestoneTurn(CAMPAIGN_MILESTONE_INTERVAL + 1)).toBe(false);
  });

  it('is true exactly on the interval and its multiples', () => {
    expect(isMilestoneTurn(CAMPAIGN_MILESTONE_INTERVAL)).toBe(true);
    expect(isMilestoneTurn(CAMPAIGN_MILESTONE_INTERVAL * 2)).toBe(true);
    expect(isMilestoneTurn(CAMPAIGN_MILESTONE_INTERVAL * 3)).toBe(true);
  });
});
