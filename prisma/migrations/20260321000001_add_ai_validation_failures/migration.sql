CREATE TABLE "ai_validation_failures" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneId" TEXT,
    "errorSummary" TEXT NOT NULL,
    "rawResponse" JSONB,
    "zodErrors" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_validation_failures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_validation_failures_campaignId_idx" ON "ai_validation_failures"("campaignId");
CREATE INDEX "ai_validation_failures_createdAt_idx" ON "ai_validation_failures"("createdAt");
