-- Per-campaign in-fiction calendar structure (month names/lengths, weekday
-- names, starting year), generated once at creation or lazily backfilled
-- for pre-existing campaigns. See lib/game/calendar.ts.
ALTER TABLE "Campaign" ADD COLUMN "calendarConfig" JSONB;

-- Durable, monotonically-increasing total in-game hours since campaign
-- epoch. Unlike hoursSinceWorldTurn (a pacing accumulator that resets every
-- world turn), this never resets -- it's the source of truth the calendar
-- formats from.
ALTER TABLE "WorldMeta" ADD COLUMN "totalElapsedGameHours" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Absolute in-game day number since campaign epoch at write time, for the
-- Story Log calendar view's day-grouping. Null for rows written before
-- this existed; never backfilled retroactively.
ALTER TABLE "campaign_logs" ADD COLUMN "inGameDayNumber" INTEGER;
CREATE INDEX "campaign_logs_campaignId_inGameDayNumber_idx" ON "campaign_logs"("campaignId", "inGameDayNumber");

-- Same day-number concept for TimelineEvent (the Rumors feed), which had
-- no date field at all before this.
ALTER TABLE "TimelineEvent" ADD COLUMN "inGameDayNumber" INTEGER;
CREATE INDEX "TimelineEvent_campaignId_inGameDayNumber_idx" ON "TimelineEvent"("campaignId", "inGameDayNumber");
