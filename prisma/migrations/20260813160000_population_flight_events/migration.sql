-- #262 (adversarial audit): a bounded event record for background
-- population flight, distinct from the existing per-location
-- LOCATION_POPULATION WorldEvent (previousValue/newValue on ONE location,
-- no record of where the people came from). Deliberately NOT per-person
-- identity -- population stays "a single number" for background flavor.
CREATE TABLE "population_flight_events" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "turnNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromLocationId" TEXT NOT NULL,
    "fromLocationName" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "toLocationName" TEXT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "population_flight_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "population_flight_events_campaignId_turnNumber_idx" ON "population_flight_events"("campaignId", "turnNumber");

CREATE INDEX "population_flight_events_campaignId_fromLocationId_idx" ON "population_flight_events"("campaignId", "fromLocationId");

CREATE INDEX "population_flight_events_campaignId_toLocationId_idx" ON "population_flight_events"("campaignId", "toLocationId");

ALTER TABLE "population_flight_events" ADD CONSTRAINT "population_flight_events_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
