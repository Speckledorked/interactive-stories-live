-- Phase 1b: push invariants Phase 1's checks already validate down into the
-- schema, so the broken state becomes unrepresentable instead of merely
-- detected-and-repaired — the same move Phase 0's War FK already made.
--
-- Every dedup step below is non-destructive: nothing is deleted or merged,
-- rows are only renamed/unlinked so the constraint can be added. Which of
-- two same-named rows is "the real one" is a judgment call (see
-- integrity/checks/duplicateNames.ts's own reasoning for staying
-- detect-only) — a migration can't make that call, so it doesn't try to.

-- --- NPC / Faction / Quest name uniqueness ---------------------------------
-- Case-insensitive on purpose: every AI write path already matches names
-- case-insensitively (entityResolution.ts's normalizeEntityName), so a
-- case-sensitive constraint would just reproduce Location's own known bug
-- (@@unique([campaignId, name]) there is case-sensitive while every writer
-- matches insensitively — see worldUpdaters/locations.ts's doc comment —
-- which has already caused split rows for Location).

WITH dupes AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "campaignId", lower(name) ORDER BY id) AS rn
  FROM "NPC"
)
UPDATE "NPC" n SET name = n.name || ' (dup ' || d.rn || ')'
FROM dupes d WHERE n.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX "NPC_campaignId_name_lower_key" ON "NPC" ("campaignId", lower(name));

WITH dupes AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "campaignId", lower(name) ORDER BY id) AS rn
  FROM "Faction"
)
UPDATE "Faction" f SET name = f.name || ' (dup ' || d.rn || ')'
FROM dupes d WHERE f.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX "Faction_campaignId_name_lower_key" ON "Faction" ("campaignId", lower(name));

WITH dupes AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "campaignId", lower(name) ORDER BY id) AS rn
  FROM "Quest"
)
UPDATE "Quest" q SET name = q.name || ' (dup ' || d.rn || ')'
FROM dupes d WHERE q.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX "Quest_campaignId_name_lower_key" ON "Quest" ("campaignId", lower(name));

-- --- Quest.objectiveKey real uniqueness ------------------------------------
-- Was @@index only, enforced solely by claimObjectiveKey's check-then-act
-- (worldUpdaters/quests.ts) — a real, if narrow, TOCTOU race. Dedup by
-- unclaiming (not renaming): objectiveKey is an internal handle, not
-- user-facing, and the existing code already treats an unkeyed quest as a
-- normal, supported state ("left unkeyed" — see claimObjectiveKey's own
-- comment), so this is the non-destructive move here, same spirit as the
-- name dedup above but suited to what this column actually is.
WITH dupes AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "campaignId", "objectiveKey" ORDER BY id) AS rn
  FROM "Quest"
  WHERE "objectiveKey" IS NOT NULL
)
UPDATE "Quest" q SET "objectiveKey" = NULL
FROM dupes d WHERE q.id = d.id AND d.rn > 1;

DROP INDEX "Quest_campaignId_objectiveKey_idx";
CREATE UNIQUE INDEX "Quest_campaignId_objectiveKey_key" ON "Quest" ("campaignId", "objectiveKey");

-- --- Range CHECK constraints ------------------------------------------------
-- Every one of these is already clamp()'d in app code before every write
-- (harm.ts, corruption.ts, standing.ts, warTick.ts, tension.ts) — confirmed
-- directly, not assumed. These constraints should never actually fire; they
-- exist so a future write path that skips the clamp fails loudly at the
-- database instead of silently drifting out of range.

ALTER TABLE "Character" ADD CONSTRAINT "Character_harm_range" CHECK (harm >= 0 AND harm <= 6);
ALTER TABLE "NPC" ADD CONSTRAINT "NPC_harm_range" CHECK (harm >= 0 AND harm <= 6);
ALTER TABLE "Character" ADD CONSTRAINT "Character_corruption_range" CHECK (corruption >= 0 AND corruption <= 5);
ALTER TABLE "FactionStanding" ADD CONSTRAINT "FactionStanding_value_range" CHECK (value >= -3 AND value <= 3);
ALTER TABLE "War" ADD CONSTRAINT "War_momentum_range" CHECK (momentum >= -100 AND momentum <= 100);
ALTER TABLE "WorldMeta" ADD CONSTRAINT "WorldMeta_tension_range" CHECK (tension >= 0 AND tension <= 100);
