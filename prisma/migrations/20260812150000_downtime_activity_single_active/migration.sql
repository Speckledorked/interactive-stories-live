-- #211: at most one ACTIVE downtime activity per character. Backstops the
-- application-level check in createDynamicActivity (ai-downtime-service.ts)
-- against the race between two concurrent requests both passing that check.
-- A real partial unique index (Prisma's @@unique has no WHERE clause), same
-- hand-written-migration approach the Phase 1b NPC/Faction/Quest-name
-- uniqueness constraints already used.
CREATE UNIQUE INDEX "downtime_activities_characterId_active_key" ON "downtime_activities" ("characterId") WHERE status = 'ACTIVE';
