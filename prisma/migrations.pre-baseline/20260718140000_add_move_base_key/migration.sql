-- Move.baseMoveKey ties a per-campaign flavor Move row back to the fixed
-- canonical move it flavors (PbtAMove.key in lib/pbta-moves.ts), so
-- resolution.ts can look up campaign-specific display text at roll time.
ALTER TABLE "Move" ADD COLUMN IF NOT EXISTS "baseMoveKey" TEXT;

CREATE INDEX IF NOT EXISTS "Move_campaignId_baseMoveKey_idx" ON "Move"("campaignId", "baseMoveKey");
