-- Confirmed-dead fields (README #90).
--
-- WorldMeta.tension (an 0-100 "dramatic tension" gauge) and WorldMeta.phase
-- (a story-arc string) were never written by any code path and read only by
-- the campaign-export dump, so every campaign that has ever existed carried
-- the same default value forever. WikiEntry.relatedEntries declared a
-- cross-reference graph with zero references anywhere in the application —
-- no writer, no reader, no UI. Removed rather than left implying features
-- that don't exist.
ALTER TABLE "WorldMeta" DROP COLUMN IF EXISTS "tension";
ALTER TABLE "WorldMeta" DROP COLUMN IF EXISTS "phase";
ALTER TABLE "wiki_entries" DROP COLUMN IF EXISTS "relatedEntries";
