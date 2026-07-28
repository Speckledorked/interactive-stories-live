-- War.contestedLocationId was a bare id with no foreign key. warTick.ts's
-- war-resolution path does an unguarded `location.update` on it, so a
-- deleted Location made that throw P2025 partway through the tick — and
-- because the tick is not transactional, the world turn was left
-- half-applied with its banked hours already consumed by the atomic claim
-- in worldTurn.ts.
--
-- Any already-dangling ids have to be cleared BEFORE the constraint is
-- added, or this migration fails on exactly the corrupt data it exists to
-- fix.
UPDATE "War"
SET "contestedLocationId" = NULL
WHERE "contestedLocationId" IS NOT NULL
  AND "contestedLocationId" NOT IN (SELECT "id" FROM "Location");

ALTER TABLE "War"
  ADD CONSTRAINT "War_contestedLocationId_fkey"
  FOREIGN KEY ("contestedLocationId") REFERENCES "Location"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "War_contestedLocationId_idx" ON "War"("contestedLocationId");
