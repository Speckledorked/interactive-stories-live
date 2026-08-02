-- #110: background population count for locations that opt in (nullable —
-- a location the GM never assigns one to is never touched by migration).
ALTER TABLE "Location" ADD COLUMN "population" INTEGER;
ALTER TABLE "Location" ADD CONSTRAINT "Location_population_nonnegative" CHECK ("population" IS NULL OR "population" >= 0);

-- #110: attributable entity type for population shifts, distinct from
-- conditionScore drift (LOCATION_CONDITION, already added by migration
-- 20260802185719_location_condition_score).
ALTER TYPE "WorldEventTargetType" ADD VALUE 'LOCATION_POPULATION';
