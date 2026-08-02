-- #119: generic signed/contested-value arc, starting with territory loyalty.
CREATE TABLE "Arc" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "startedTurn" INTEGER NOT NULL,
    "locationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Arc_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Arc_locationId_key" ON "Arc"("locationId");
CREATE INDEX "Arc_campaignId_idx" ON "Arc"("campaignId");
CREATE INDEX "Arc_locationId_idx" ON "Arc"("locationId");

ALTER TABLE "Arc" ADD CONSTRAINT "Arc_value_range" CHECK ("value" >= -100 AND "value" <= 100);

ALTER TABLE "Arc" ADD CONSTRAINT "Arc_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Arc" ADD CONSTRAINT "Arc_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
