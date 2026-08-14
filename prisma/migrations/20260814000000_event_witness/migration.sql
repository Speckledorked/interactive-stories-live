-- #101: per-character knowledge of significant WorldEvents (WITNESSED vs.
-- TOLD). Real FKs with ON DELETE CASCADE -- unlike PopulationFlightEvent's
-- denormalized location strings, a witness row is meaningless once its
-- event or character is gone.
CREATE TYPE "EventWitnessGrade" AS ENUM ('WITNESSED', 'TOLD');

CREATE TABLE "event_witnesses" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "worldEventId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "grade" "EventWitnessGrade" NOT NULL,
    "turnNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_witnesses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "event_witnesses_worldEventId_characterId_key" ON "event_witnesses"("worldEventId", "characterId");

CREATE INDEX "event_witnesses_campaignId_characterId_turnNumber_idx" ON "event_witnesses"("campaignId", "characterId", "turnNumber");

CREATE INDEX "event_witnesses_worldEventId_idx" ON "event_witnesses"("worldEventId");

ALTER TABLE "event_witnesses" ADD CONSTRAINT "event_witnesses_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_witnesses" ADD CONSTRAINT "event_witnesses_worldEventId_fkey" FOREIGN KEY ("worldEventId") REFERENCES "world_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_witnesses" ADD CONSTRAINT "event_witnesses_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
