-- Restore WorldMeta.tension / WorldMeta.phase and WikiEntry.relatedEntries.
--
-- These were dropped as confirmed-dead columns (README #90) — nothing
-- wrote them, so every campaign carried the same default forever. They're
-- back because the features behind them are now implemented rather than
-- implied: tension is recomputed deterministically each world turn and
-- read at clock-advancement time, phase is derived from it, and
-- relatedEntries is written by the wiki sync and rendered as links.
ALTER TABLE "WorldMeta"
  ADD COLUMN IF NOT EXISTS "tension" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "phase" TEXT;

ALTER TABLE "wiki_entries" ADD COLUMN IF NOT EXISTS "relatedEntries" JSONB;
