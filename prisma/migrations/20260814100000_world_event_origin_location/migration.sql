-- #101 v1.1: capture where a WorldEvent happened at write time, rather than
-- approximating it later from the target entity's CURRENT location. No FK,
-- matching the existing plain-string convention for "targetId".
ALTER TABLE "world_events" ADD COLUMN "originLocationId" TEXT;
