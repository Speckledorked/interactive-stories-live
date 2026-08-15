-- #291: async map generation, mirroring SceneImage's shape exactly — moves
-- map generation off the synchronous scene-resolution path onto the same
-- job-queue pattern scene illustration already uses.

CREATE TABLE "MapGenerationJob" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "status" "ResolutionJobStatus" NOT NULL DEFAULT 'PENDING',
    "sceneDescription" TEXT NOT NULL,
    "previousMapId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "alertedStuckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "MapGenerationJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MapGenerationJob_sceneId_key" ON "MapGenerationJob"("sceneId");
CREATE INDEX "MapGenerationJob_campaignId_status_idx" ON "MapGenerationJob"("campaignId", "status");
