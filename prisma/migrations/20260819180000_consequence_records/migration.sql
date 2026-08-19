-- Character.consequences entries become records that can be RETIRED.
--
-- The arrays held bare strings: { promises: string[], enemies: string[],
-- longTermThreats: string[], ... }. A string has no identity and no status,
-- so the only expressible operations were "append" and "splice out". That is
-- why a player watched the threat list grow all campaign and never shrink,
-- and why the one path that COULD remove an entry destroyed it — surviving a
-- contract that hunted you for six sessions became indistinguishable from it
-- never having happened.
--
-- New shape per entry: { text, status: 'active'|'resolved', since?, resolvedAt? }
--
-- This backfill converts existing strings to active records. It is not
-- strictly required — normalizeConsequenceList (lib/game/consequenceRecords.ts)
-- reads both shapes, deliberately, so nothing breaks before or without this
-- migration. It runs anyway so the stored data matches the model rather than
-- relying on read-time tolerance forever, which is how two representations
-- quietly become permanent.
--
-- Every legacy string becomes ACTIVE, which is the only honest reading: the
-- old format could not express resolution, so everything in it is something
-- nobody ever said was over.
--
-- Idempotent. jsonb_typeof filters to string elements only, so an entry
-- already converted to an object is left exactly as it is and a re-run is a
-- no-op. Rows whose consequences are NULL or hold no arrays are untouched.

UPDATE "Character" c
SET consequences = (
  SELECT jsonb_object_agg(
    key,
    CASE
      WHEN jsonb_typeof(value) = 'array' THEN (
        SELECT COALESCE(jsonb_agg(
          CASE
            WHEN jsonb_typeof(elem) = 'string'
              THEN jsonb_build_object('text', elem #>> '{}', 'status', 'active')
            ELSE elem
          END
        ), '[]'::jsonb)
        FROM jsonb_array_elements(value) AS elem
      )
      ELSE value
    END
  )
  FROM jsonb_each(c.consequences::jsonb)
)
WHERE c.consequences IS NOT NULL
  AND jsonb_typeof(c.consequences::jsonb) = 'object'
  AND EXISTS (
    SELECT 1
    FROM jsonb_each(c.consequences::jsonb) AS kv(key, value),
         jsonb_array_elements(CASE WHEN jsonb_typeof(kv.value) = 'array' THEN kv.value ELSE '[]'::jsonb END) AS elem
    WHERE jsonb_typeof(elem) = 'string'
  );
