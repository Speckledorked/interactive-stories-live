-- #214: optimistic-concurrency version counter for applyOrganicCharacterGrowth's
-- read-then-write outside the pc_changes transaction. See Character.advancementVersion's
-- schema doc comment.
ALTER TABLE "Character" ADD COLUMN "advancementVersion" INTEGER NOT NULL DEFAULT 0;
