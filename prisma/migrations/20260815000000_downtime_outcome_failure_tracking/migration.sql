-- #305: track when a downtime activity's completion-outcome AI call (or
-- its response parse/shape check) fails after the activity has already
-- been marked COMPLETED, so the lost reward is auditable and retriable
-- instead of silent and final.
ALTER TABLE "downtime_activities" ADD COLUMN "outcomeGenerationFailedAt" TIMESTAMP(3);

CREATE INDEX "downtime_activities_characterId_outcomeGenerationFailedAt_idx" ON "downtime_activities"("characterId", "outcomeGenerationFailedAt");
