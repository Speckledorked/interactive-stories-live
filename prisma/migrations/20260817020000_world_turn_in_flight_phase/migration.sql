-- #436: pin the turn number across a retry, and record how far the turn got.
--
-- simulationTurn commits inside runWorldTick's transaction, but a world turn
-- is much more than its tick. A failure in any post-commit phase left
-- simulationTurn already advanced, so the retry derived `simulationTurn + 1`
-- and ran one turn HIGHER than the attempt it was retrying — which meant
-- every dedupeKey differed and nothing could ever collide. The replay-safety
-- keys could not fire on the one path they were written for.
--
-- turnInFlight pins the number. turnPhaseCompleted stops the non-idempotent
-- phases (clock advancement, clock resolution, ambition resolution) from
-- re-applying what already succeeded — the same "processed through turn N"
-- watermark shape already used by Faction.beliefDriftThroughTurn.

ALTER TABLE "WorldMeta" ADD COLUMN "turnInFlight" INTEGER;
ALTER TABLE "WorldMeta" ADD COLUMN "turnPhaseCompleted" INTEGER NOT NULL DEFAULT 0;

-- Existing rows are not mid-turn: any turn that was in flight when this
-- migration runs has already lost its process, and its lease will age out.
-- NULL is the correct starting state — "no partial turn" — and the default
-- above gives the watermark the same meaning.
