-- Phase 16: Freeform Combat & Exchange-Based Action System
-- Add exchange tracking to scenes and actions

-- Add Phase 16 fields to Scene model
ALTER TABLE "Scene" ADD COLUMN "combatMode" TEXT DEFAULT 'freeform';
ALTER TABLE "Scene" ADD COLUMN "exchangeState" JSONB;
ALTER TABLE "Scene" ADD COLUMN "currentExchange" INTEGER NOT NULL DEFAULT 0;

-- Add Phase 16 zone positioning to Character model
ALTER TABLE "Character" ADD COLUMN "currentZone" TEXT;
ALTER TABLE "Character" ADD COLUMN "zoneMetadata" JSONB;

-- Add Phase 16 exchange tracking to PlayerAction model
ALTER TABLE "PlayerAction" ADD COLUMN "exchangeNumber" INTEGER;
ALTER TABLE "PlayerAction" ADD COLUMN "actionPriority" INTEGER DEFAULT 0;

-- Create index for exchange-based queries
CREATE INDEX "PlayerAction_exchangeNumber_idx" ON "PlayerAction"("exchangeNumber");
CREATE INDEX "Scene_currentExchange_idx" ON "Scene"("currentExchange");
