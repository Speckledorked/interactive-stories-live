-- #109: Location condition score — a persisted health/decay signal, same
-- DB-checked-range convention as War.momentum/NPC.harm (Phase 1b). See
-- tick/locationConditionTick.ts for the tick handler that drifts this.
ALTER TABLE "Location" ADD COLUMN "conditionScore" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "Location" ADD CONSTRAINT "Location_conditionScore_range" CHECK ("conditionScore" >= 0 AND "conditionScore" <= 100);

-- Location-condition tick changes (game/tick/locationConditionTick.ts) get
-- their own WorldEvent target type, mirroring LOCATION_WEATHER.
ALTER TYPE "WorldEventTargetType" ADD VALUE 'LOCATION_CONDITION';
