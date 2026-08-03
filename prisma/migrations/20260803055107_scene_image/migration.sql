-- #96: AI-generated scene illustration, one image per resolved scene.

ALTER TABLE "Campaign" ADD COLUMN "sceneImageGenerationEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SceneImage" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "status" "ResolutionJobStatus" NOT NULL DEFAULT 'PENDING',
    "prompt" TEXT,
    "imageUrl" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "alertedStuckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SceneImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SceneImage_sceneId_key" ON "SceneImage"("sceneId");
CREATE INDEX "SceneImage_campaignId_status_idx" ON "SceneImage"("campaignId", "status");
