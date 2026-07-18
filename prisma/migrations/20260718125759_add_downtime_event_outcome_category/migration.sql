-- Add DowntimeEvent.outcomeCategory (depth audit follow-up, July 2026):
-- the deterministic, riskLevel-weighted category (setback/complication/
-- smooth/opportunity) rolled server-side before the AI narrates a
-- downtime day's event — see lib/downtime/downtimeEventOutcome.ts.
-- Nullable/additive: existing rows and any environment that already has
-- this column (IF NOT EXISTS) are unaffected.

ALTER TABLE "downtime_events" ADD COLUMN IF NOT EXISTS "outcomeCategory" TEXT;
