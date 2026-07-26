-- World Sim Phase 1: World Tick, NPC Goals, Faction State, Persistent Weather

-- CreateEnum
CREATE TYPE "FactionGoal" AS ENUM ('EXPAND', 'DEFEND', 'ENRICH', 'DESTABILIZE_RIVAL', 'CONSOLIDATE');

-- CreateEnum
CREATE TYPE "WeatherCondition" AS ENUM ('CLEAR', 'CLOUDY', 'RAIN', 'STORM', 'SNOW', 'FOG');

-- AlterTable: NPC gets a currentPlan field for tick-driven behavior
ALTER TABLE "NPC" ADD COLUMN "currentPlan" TEXT;

-- AlterTable: Faction gets the 4 tracked simulation fields alongside the
-- existing influence/threatLevel/currentPlan/goals columns (kept as-is).
ALTER TABLE "Faction" ADD COLUMN "stability" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "Faction" ADD COLUMN "military" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "Faction" ADD COLUMN "goal" "FactionGoal" NOT NULL DEFAULT 'CONSOLIDATE';

-- AlterTable: Location gets persistent weather
ALTER TABLE "Location" ADD COLUMN "weather" "WeatherCondition" NOT NULL DEFAULT 'CLEAR';
ALTER TABLE "Location" ADD COLUMN "weatherSeverity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Location" ADD COLUMN "weatherUpdatedAt" TIMESTAMP(3);
