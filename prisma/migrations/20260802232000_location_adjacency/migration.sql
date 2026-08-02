-- #108: flat, undirected adjacency edges between two locations.
CREATE TABLE "LocationAdjacency" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "locationAId" TEXT NOT NULL,
    "locationBId" TEXT NOT NULL,
    "distance" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationAdjacency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LocationAdjacency_locationAId_locationBId_key" ON "LocationAdjacency"("locationAId", "locationBId");
CREATE INDEX "LocationAdjacency_campaignId_idx" ON "LocationAdjacency"("campaignId");
CREATE INDEX "LocationAdjacency_locationAId_idx" ON "LocationAdjacency"("locationAId");
CREATE INDEX "LocationAdjacency_locationBId_idx" ON "LocationAdjacency"("locationBId");

ALTER TABLE "LocationAdjacency" ADD CONSTRAINT "LocationAdjacency_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocationAdjacency" ADD CONSTRAINT "LocationAdjacency_locationAId_fkey" FOREIGN KEY ("locationAId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocationAdjacency" ADD CONSTRAINT "LocationAdjacency_locationBId_fkey" FOREIGN KEY ("locationBId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
