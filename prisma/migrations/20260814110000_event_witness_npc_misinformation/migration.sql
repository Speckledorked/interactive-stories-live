-- #101: misinformation + NPC-carried rumors. NPCs can now be TOLD (never
-- WITNESSED — see stateUpdater.ts, scene-participant-only) about
-- significant WorldEvents, and any TOLD account (Character or NPC) can be
-- a specific, deterministic kind of wrong. Never touches world_events.reason
-- (ground truth) — see EventWitness's own schema comment.
CREATE TYPE "EventWitnessDistortion" AS ENUM ('EXAGGERATED', 'MINIMIZED', 'GARBLED_DETAIL', 'ATTRIBUTED_WRONG');

ALTER TABLE "event_witnesses" ALTER COLUMN "characterId" DROP NOT NULL;
ALTER TABLE "event_witnesses" ADD COLUMN "npcId" TEXT;
ALTER TABLE "event_witnesses" ADD COLUMN "distorted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "event_witnesses" ADD COLUMN "distortionFlavor" "EventWitnessDistortion";

CREATE UNIQUE INDEX "event_witnesses_worldEventId_npcId_key" ON "event_witnesses"("worldEventId", "npcId");

CREATE INDEX "event_witnesses_campaignId_npcId_turnNumber_idx" ON "event_witnesses"("campaignId", "npcId", "turnNumber");

ALTER TABLE "event_witnesses" ADD CONSTRAINT "event_witnesses_npcId_fkey" FOREIGN KEY ("npcId") REFERENCES "NPC"("id") ON DELETE CASCADE ON UPDATE CASCADE;
