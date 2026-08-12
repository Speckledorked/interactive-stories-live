-- #227: snapshot the FactionGoal an ambition clock was spawned to pursue,
-- so belief-drift changing Faction.goal later can't retroactively change
-- how an already-committed ambition (or its continuation) resolves.
ALTER TABLE "Clock" ADD COLUMN "goal" "FactionGoal";
