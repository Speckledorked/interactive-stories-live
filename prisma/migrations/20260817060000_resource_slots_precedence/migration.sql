-- #445 (F-04): re-derive Location.resourceSlots with the SAME PRECEDENCE the
-- code uses.
--
-- #378's backfill (20260816090000_world_turn_integrity) and
-- src/lib/game/resourceSlots.ts implement the same rule two different ways,
-- and they do not agree:
--
--   The backfill concatenated locationType, name and description into ONE
--   haystack and tested `ruin|wasteland|...` against it FIRST.
--   deriveResourceSlots tests each haystack SEPARATELY, in priority order
--   (type, then name, then description), running the full hint list against
--   each — and `ruin|wasteland|...` is LAST in that list, not first.
--
-- So "Ironhold Mine, once a ruin of the old kingdom" derives to ['ore'] in
-- code and to [] in SQL. Every such row was backfilled to produce nothing,
-- permanently, which is the exact failure #378 existed to close — reproduced
-- by the fix for it.
--
-- This CASE is GENERATED FROM TYPE_HINTS: three haystacks in priority order,
-- the full hint list against each, in the array's own order. A structural
-- guard (resourceSlotsPrecedence.test.ts) parses this file and the TS module
-- and fails if the two ever drift again, so "one rule, two implementations"
-- is at least a checkable one rule.
--
-- Applied wherever the two disagree, rather than to every row: `IS DISTINCT
-- FROM` makes this a no-op on a database whose slots are already correct,
-- and idempotent on a re-run. resourceSlots has no authoring surface (see
-- game/resourceSlots.ts), so nothing hand-written can be overwritten here.
UPDATE "Location"
   SET "resourceSlots" = derived.slots
  FROM (
    SELECT
      id,
      CASE
       WHEN COALESCE("locationType", '') ~* '(mine|quarry|forge|foundry|smelt)'
            THEN ARRAY['ore']
       WHEN COALESCE("locationType", '') ~* '(farm|field|orchard|vineyard|granary|pasture)'
            THEN ARRAY['grain']
       WHEN COALESCE("locationType", '') ~* '(forest|wood|lumber|grove|timber)'
            THEN ARRAY['timber']
       WHEN COALESCE("locationType", '') ~* '(port|harbor|harbour|market|bazaar|caravan|trade|dock)'
            THEN ARRAY['trade']
       WHEN COALESCE("locationType", '') ~* '(librar|archive|academy|temple|monaster|scriptorium|college)'
            THEN ARRAY['lore']
       WHEN COALESCE("locationType", '') ~* '(city|capital)'
            THEN ARRAY['trade', 'grain']
       WHEN COALESCE("locationType", '') ~* '(town|village|settlement|hold|keep|fort|citadel)'
            THEN ARRAY['grain']
       WHEN COALESCE("locationType", '') ~* '(ruin|wasteland|wilds|wilderness|badlands|swamp|desert|tomb|crypt)'
            THEN ARRAY[]::text[]
       WHEN COALESCE(name, '') ~* '(mine|quarry|forge|foundry|smelt)'
            THEN ARRAY['ore']
       WHEN COALESCE(name, '') ~* '(farm|field|orchard|vineyard|granary|pasture)'
            THEN ARRAY['grain']
       WHEN COALESCE(name, '') ~* '(forest|wood|lumber|grove|timber)'
            THEN ARRAY['timber']
       WHEN COALESCE(name, '') ~* '(port|harbor|harbour|market|bazaar|caravan|trade|dock)'
            THEN ARRAY['trade']
       WHEN COALESCE(name, '') ~* '(librar|archive|academy|temple|monaster|scriptorium|college)'
            THEN ARRAY['lore']
       WHEN COALESCE(name, '') ~* '(city|capital)'
            THEN ARRAY['trade', 'grain']
       WHEN COALESCE(name, '') ~* '(town|village|settlement|hold|keep|fort|citadel)'
            THEN ARRAY['grain']
       WHEN COALESCE(name, '') ~* '(ruin|wasteland|wilds|wilderness|badlands|swamp|desert|tomb|crypt)'
            THEN ARRAY[]::text[]
       WHEN COALESCE(description, '') ~* '(mine|quarry|forge|foundry|smelt)'
            THEN ARRAY['ore']
       WHEN COALESCE(description, '') ~* '(farm|field|orchard|vineyard|granary|pasture)'
            THEN ARRAY['grain']
       WHEN COALESCE(description, '') ~* '(forest|wood|lumber|grove|timber)'
            THEN ARRAY['timber']
       WHEN COALESCE(description, '') ~* '(port|harbor|harbour|market|bazaar|caravan|trade|dock)'
            THEN ARRAY['trade']
       WHEN COALESCE(description, '') ~* '(librar|archive|academy|temple|monaster|scriptorium|college)'
            THEN ARRAY['lore']
       WHEN COALESCE(description, '') ~* '(city|capital)'
            THEN ARRAY['trade', 'grain']
       WHEN COALESCE(description, '') ~* '(town|village|settlement|hold|keep|fort|citadel)'
            THEN ARRAY['grain']
       WHEN COALESCE(description, '') ~* '(ruin|wasteland|wilds|wilderness|badlands|swamp|desert|tomb|crypt)'
            THEN ARRAY[]::text[]
       ELSE ARRAY['grain']
      END AS slots
    FROM "Location"
  ) AS derived
 WHERE "Location".id = derived.id
   AND "Location"."resourceSlots" IS DISTINCT FROM derived.slots;
