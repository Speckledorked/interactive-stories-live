-- Campaign lobby "Living Chronicle" redesign: cached per-turn narration
-- text plus a one-time generated hero banner image. See
-- src/lib/game/chronicleContext.ts / chronicleNarration.ts / campaignHeroImage.ts.

ALTER TABLE "WorldMeta" ADD COLUMN "chronicleNarration" TEXT;
ALTER TABLE "WorldMeta" ADD COLUMN "chronicleNarrationTurn" INTEGER;

ALTER TABLE "Campaign" ADD COLUMN "heroImageUrl" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "heroImageStatus" TEXT NOT NULL DEFAULT 'NONE';
