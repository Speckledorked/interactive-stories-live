-- Structured, permanent character knowledge (#173/#174) — see
-- lib/game/knowledge.ts.
ALTER TABLE "Character" ADD COLUMN "knownConcepts" JSONB;
