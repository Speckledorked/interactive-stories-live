-- World Sim: persisted event stream (WorldEvent)

-- CreateEnum
CREATE TYPE "WorldEventActorType" AS ENUM ('SYSTEM', 'PLAYER');

-- CreateEnum
CREATE TYPE "WorldEventTargetType" AS ENUM ('NPC', 'FACTION', 'LOCATION_WEATHER');

-- CreateTable
CREATE TABLE "world_events" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "turnNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "actorType" "WorldEventActorType" NOT NULL DEFAULT 'SYSTEM',
    "actorId" TEXT,
    "targetType" "WorldEventTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT NOT NULL,
    "significant" BOOLEAN NOT NULL DEFAULT false,
    "importance" TEXT NOT NULL DEFAULT 'NORMAL',

    CONSTRAINT "world_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "world_events_campaignId_turnNumber_idx" ON "world_events"("campaignId", "turnNumber");

-- CreateIndex
CREATE INDEX "world_events_campaignId_targetType_targetId_idx" ON "world_events"("campaignId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "world_events_campaignId_type_idx" ON "world_events"("campaignId", "type");

-- AddForeignKey
ALTER TABLE "world_events" ADD CONSTRAINT "world_events_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
