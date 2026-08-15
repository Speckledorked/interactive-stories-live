CREATE TABLE "memory_creation_failures" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "memoryType" "MemoryType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "turnNumber" INTEGER NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_creation_failures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "memory_creation_failures_campaignId_idx" ON "memory_creation_failures"("campaignId");

CREATE INDEX "memory_creation_failures_createdAt_idx" ON "memory_creation_failures"("createdAt");
