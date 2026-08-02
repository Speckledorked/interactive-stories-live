-- #103: temporary, decaying stability penalty rippling out from an NPC's
-- death or a faction's collapse. One row per (source, affected faction).
CREATE TABLE "ActiveWake" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "sourceEntityName" TEXT NOT NULL,
    "affectedFactionId" TEXT NOT NULL,
    "totalStabilityPenalty" INTEGER NOT NULL,
    "currentTicks" INTEGER NOT NULL DEFAULT 0,
    "maxTicks" INTEGER NOT NULL DEFAULT 5,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActiveWake_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActiveWake_sourceType_sourceEntityId_affectedFactionId_key" ON "ActiveWake"("sourceType", "sourceEntityId", "affectedFactionId");
CREATE INDEX "ActiveWake_campaignId_idx" ON "ActiveWake"("campaignId");
CREATE INDEX "ActiveWake_affectedFactionId_idx" ON "ActiveWake"("affectedFactionId");

ALTER TABLE "ActiveWake" ADD CONSTRAINT "ActiveWake_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActiveWake" ADD CONSTRAINT "ActiveWake_affectedFactionId_fkey" FOREIGN KEY ("affectedFactionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
