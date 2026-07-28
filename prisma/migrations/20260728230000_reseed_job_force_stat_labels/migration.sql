-- Admin opt-in flag: overwrite stat labels from imported canon even on a
-- "live" campaign (characters already exist), where reseed is otherwise
-- fill-only. Stat labels are pure display flavor over the fixed stat
-- keys, so this is safe to apply retroactively. See reseedWorld.ts.
ALTER TABLE "ReseedJob" ADD COLUMN "forceStatLabels" BOOLEAN NOT NULL DEFAULT false;
