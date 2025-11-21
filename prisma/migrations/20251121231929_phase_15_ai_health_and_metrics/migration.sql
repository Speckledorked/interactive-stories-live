-- AlterTable: Add Phase 15 AI Health and Metrics fields to WorldMeta
ALTER TABLE "WorldMeta" ADD COLUMN     "aiHealth" JSONB,
ADD COLUMN     "aiMetrics" JSONB,
ADD COLUMN     "campaignHealthHistory" JSONB,
ADD COLUMN     "lastHealthCheck" TIMESTAMP(3),
ADD COLUMN     "currentHealthScore" INTEGER;
