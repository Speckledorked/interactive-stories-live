-- Character.currentZone / zoneMetadata backed an abstract close/near/far/
-- distant positioning system (ZoneManager) whose entire class had zero
-- consumers anywhere outside its own file — it never gated an action, and
-- ran in parallel to the literal x/y Map/Zone/Token grid without the two
-- ever reconciling (README #2/#43, #85). Removed so the grid system is the
-- single positioning model, rather than keeping two that disagree.
ALTER TABLE "Character" DROP COLUMN IF EXISTS "currentZone";
ALTER TABLE "Character" DROP COLUMN IF EXISTS "zoneMetadata";
