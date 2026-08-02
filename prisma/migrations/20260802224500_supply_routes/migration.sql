-- #106: extractable-resource-type tags per location (flat list, no
-- per-element structure — same shape as Clock.participantNpcIds).
ALTER TABLE "Location" ADD COLUMN "resourceSlots" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- #106: flat, arbitrary supply routes between two locations.
CREATE TABLE "SupplyRoute" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "controllingFactionId" TEXT,
    "isBlockaded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyRoute_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplyRoute_campaignId_idx" ON "SupplyRoute"("campaignId");
CREATE INDEX "SupplyRoute_fromLocationId_idx" ON "SupplyRoute"("fromLocationId");
CREATE INDEX "SupplyRoute_toLocationId_idx" ON "SupplyRoute"("toLocationId");
CREATE INDEX "SupplyRoute_controllingFactionId_idx" ON "SupplyRoute"("controllingFactionId");

ALTER TABLE "SupplyRoute" ADD CONSTRAINT "SupplyRoute_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyRoute" ADD CONSTRAINT "SupplyRoute_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyRoute" ADD CONSTRAINT "SupplyRoute_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyRoute" ADD CONSTRAINT "SupplyRoute_controllingFactionId_fkey" FOREIGN KEY ("controllingFactionId") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
