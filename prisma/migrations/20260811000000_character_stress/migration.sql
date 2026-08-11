-- Accumulated, recoverable psychological pressure — see Character.stress doc comment.
ALTER TABLE "Character" ADD COLUMN "stress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD CONSTRAINT "Character_stress_range" CHECK (stress >= 0 AND stress <= 10);
