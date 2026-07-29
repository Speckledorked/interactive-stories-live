-- Phase 2: persist Integrity Engine pass history, mirroring the existing
-- campaignHealthHistory / lastHealthCheck columns' shape and purpose but
-- kept as separate columns — this is a different axis (world-data
-- coherence) from campaign-health.ts's narrative/operational score.

ALTER TABLE "WorldMeta" ADD COLUMN "integrityReportHistory" JSONB;
ALTER TABLE "WorldMeta" ADD COLUMN "lastIntegrityCheck" TIMESTAMP(3);
