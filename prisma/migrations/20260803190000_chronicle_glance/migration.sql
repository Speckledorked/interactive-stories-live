-- "World at a Glance" lobby tile row: a plain-data snapshot of the same
-- signals already gathered for the World Chronicle prose (weather, top
-- faction, active conflicts, recent events), derived once per world turn
-- alongside chronicleNarration — no new query, no AI call. See
-- src/lib/game/chronicleContext.ts's deriveChronicleGlance.

ALTER TABLE "WorldMeta" ADD COLUMN "chronicleGlance" JSONB;
