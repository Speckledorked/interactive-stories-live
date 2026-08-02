-- How often a CampaignMemory has actually been retrieved, and when it was
-- last retrieved — a frequency signal memoryConsolidation.ts uses to exempt
-- memories that keep proving useful from being rolled into an era summary
-- (see #107).
ALTER TABLE "campaign_memories" ADD COLUMN "retrievalCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "campaign_memories" ADD COLUMN "lastRetrievedTurn" INTEGER;
